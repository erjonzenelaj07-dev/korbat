#!/usr/bin/env node
/**
 * Lists, and with --yes deletes, what tests left in the development database:
 *
 * - accounts whose email has the tests' shape, `<word>-<uuid>@korbat.local` (the integration, HTTP and
 *   smoke tests all make them), with their profiles;
 * - profiles without an account behind them, which the integration suites inserted directly while they
 *   still ran against this database.
 *
 * An account that holds a staff key is kept, whatever its email: staff keys are never deleted, because audit-verify
 * checks old confirmations against their public keys, and the database refuses to delete an account that has one.
 * For the same reason an account is kept when the moderation record names it: one that decided anything, one on
 * either side of a staff link (auth.staff_personal_accounts, whose keys would otherwise fail the whole cleanup), and
 * the subject of a case that a decision or a reveal names. Decisions, their measures and the audit rows that confirm
 * them are kept for good, so what they are about stays too. And an account is kept when a moderation row that stays
 * names it as staff: the finder of an intake that keeps an item, the author of a staff text and the staff of an access
 * row in a case that stays. A case stays when the account it is about does, so this rule is applied until it adds
 * nobody.
 *
 * Every other case about a deleted account, or about one of its posts, is deleted with it: posts and profiles are
 * never deleted in production, so such a case could never be decided and would stay in the development queue after
 * every smoke run. Its items go first, because an unanswered report of child sexual abuse material freezes every
 * image its case reaches and the database then refuses to delete those images; then its holds, released before they
 * are deleted so that the images stop being retained; then its access rows, staff texts and snapshots; then the case,
 * and every intake that is left without an item. A seal is never met: it belongs to a decision, and the subject of a
 * decided case is kept.
 *
 * Deleting a profile removes its posts, image rows, follows, likes, reposts, bookmarks, blocks and mutes.
 * Where those rows counted towards a kept profile or post (a follow of a real account, a like of a real
 * post), that counter is recomputed from the rows, the way the app keeps it. The API's sweeper removes
 * the image files within about an hour, as it does for any image without a row.
 *
 * Refuses to run unless Docker's context is this machine and API_APP_ORIGIN in infra/.env is a localhost origin, so it never touches a
 * deployed database. Runs psql inside the postgres container as its superuser: no password is read or
 * printed here.
 *
 * Usage, from the repo root:
 *   node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]
 * Without a command it uses `docker compose -f infra/compose.yml -f infra/compose.dev.yml`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? ["docker", "compose", "-f", "infra/compose.yml", "-f", "infra/compose.dev.yml"] : argv.slice(separator + 1);
const unknown = options.filter((option) => option !== "--yes");
if (compose.length === 0 || unknown.length > 0) {
  console.error("usage: node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]");
  process.exit(2);
}
const yes = options.includes("--yes");

/** The only emails tests create: a lowercase word or words, a UUID, and the korbat.local domain. */
const TEST_EMAIL = "^[a-z]+(-[a-z]+)*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@korbat[.]local$";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/** How many of each kind are printed; the counts are always complete. */
const LISTED = 25;
const NL = String.fromCharCode(10);
/** psql meta-commands start with a backslash; spelled this way, the file holds none that could be lost in copying. */
const META = String.fromCharCode(92);

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

const envFile = resolve(root, "infra/.env");
if (!existsSync(envFile)) stop("infra/.env is missing. Run `node scripts/gen-dev-env.mjs` first.");
const origin = parseEnv(readFileSync(envFile, "utf8")).API_APP_ORIGIN ?? "";
let host = "";
try {
  host = new URL(origin).hostname;
} catch {
  host = "";
}
if (!LOCAL_HOSTS.includes(host)) stop(`API_APP_ORIGIN in infra/.env is "${origin}", not a localhost origin. This script only cleans a development database.`);

// Runs inside the postgres container, where POSTGRES_USER and POSTGRES_DB are set. psql fills in
// :'pattern' itself, so the pattern is never pasted into SQL by hand. Everything happens in one
// transaction, which only commits with --yes.
const script = `set -eu
psql -v ON_ERROR_STOP=1 -q -tA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pattern="$PATTERN" -v delete="$DELETE" <<'SQL'
begin;
create temp table candidates on commit drop as
  select u.id, 'account' as kind, u.email || coalesce(' (@' || p.handle || ')', '') as label
    from auth.users u left join public.profiles p on p.id = u.id
    where u.email ~ :'pattern'
  union all
  select p.id, 'profile', '@' || p.handle
    from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id);
-- Kept: a staff key's holder, whoever decided anything, either side of a staff link, and the subject of a case that a
-- decision or a reveal names (the account itself, or the author of the case's post).
create temp table kept on commit drop as
  select c.id, c.kind
    from candidates c
    where exists (select 1 from auth.staff_keys k where k.user_id = c.id)
       or exists (select 1 from public.decisions d where d.decided_by = c.id)
       or exists (select 1 from auth.staff_personal_accounts l where l.staff_user_id = c.id or l.personal_user_id = c.id)
       or exists (
         select 1 from public.cases cs
          where ((cs.target_type = 'account' and cs.target_id = c.id)
              or (cs.target_type = 'post' and cs.target_id in (select po.id from public.posts po where po.author_id = c.id)))
            and (exists (select 1 from public.decisions d where d.case_id = cs.id)
              or exists (select 1 from public.case_access_log a where a.case_id = cs.id and a.kind = 'identity_revealed')));
-- Kept as well: whoever a moderation row that stays names as staff. A case stays unless it is about an account that goes,
-- or about a post of one; an intake stays unless every item it has is in a case that goes. The finder of an intake that
-- stays, the author of a staff text and the staff of an access row in a case that stays are kept with it. Keeping an
-- account keeps the cases about it, which can name further accounts, so the rule is applied until it adds nobody.
do $$
declare
  added integer;
begin
  loop
    with going as (
      select c.id from candidates c where c.id not in (select id from kept)
    ), going_cases as (
      select cs.id
        from public.cases cs
        where (cs.target_type = 'account' and cs.target_id in (select id from going))
           or (cs.target_type = 'post' and cs.target_id in (select po.id from public.posts po where po.author_id in (select id from going)))
    )
    insert into kept (id, kind)
      select c.id, c.kind
        from candidates c
        where c.id in (select id from going)
          and (exists (
                 select 1 from public.intakes n
                  where n.finding_by = c.id
                    and (not exists (select 1 from public.intake_items i where i.intake_id = n.id and i.case_id in (select id from going_cases))
                      or exists (select 1 from public.intake_items i where i.intake_id = n.id and (i.case_id is null or i.case_id not in (select id from going_cases)))))
            or exists (select 1 from public.staff_texts t where t.author_id = c.id and t.case_id not in (select id from going_cases))
            or exists (select 1 from public.case_access_log a where a.staff_id = c.id and a.case_id not in (select id from going_cases)));
    get diagnostics added = row_count;
    exit when added = 0;
  end loop;
end $$;
create temp table doomed on commit drop as
  select c.id, c.kind, c.label from candidates c where c.id not in (select id from kept);
-- The cases that go with them: about a doomed account, or about a post of one. None has a decision.
create temp table doomed_cases on commit drop as
  select cs.id
    from public.cases cs
    where (cs.target_type = 'account' and cs.target_id in (select id from doomed))
       or (cs.target_type = 'post' and cs.target_id in (select po.id from public.posts po where po.author_id in (select id from doomed)));
create temp table touched_profiles on commit drop as
  select f.followee_id as id from public.follows f
    where f.follower_id in (select id from doomed) and f.followee_id not in (select id from doomed)
  union
  select f.follower_id from public.follows f
    where f.followee_id in (select id from doomed) and f.follower_id not in (select id from doomed);
create temp table touched_posts on commit drop as
  select distinct x.post_id as id
    from (
      select user_id as by_id, post_id from public.likes
      union all select user_id, post_id from public.reposts
      union all select author_id, reply_to_id from public.posts where reply_to_id is not null
      union all select author_id, quote_of_id from public.posts where quote_of_id is not null
    ) x
    join public.posts p on p.id = x.post_id
    where x.by_id in (select id from doomed) and p.author_id not in (select id from doomed);
select 'database|' || current_database();
select 'accounts|' || count(*) from doomed where kind = 'account';
select 'kept|' || count(*) from kept where kind = 'account';
select 'profiles|' || count(*) from doomed where kind = 'profile';
select 'profiles_kept|' || count(*) from kept where kind = 'profile';
select 'cases|' || count(*) from doomed_cases;
select 'posts|' || count(*) from public.posts where author_id in (select id from doomed);
select 'images|' || count(*) from public.post_media where owner_id in (select id from doomed);
select 'touched_profiles|' || count(*) from touched_profiles;
select 'touched_posts|' || count(*) from touched_posts;
select kind || '-item|' || label from doomed order by kind, label;
${META}if :delete
-- The intakes these cases' items belong to: those that lose every item go with them.
create temp table emptied_intakes on commit drop as
  select distinct i.intake_id as id from public.intake_items i where i.case_id in (select id from doomed_cases);
-- The items first: deleting an unanswered suspect item is what ends its freeze.
delete from public.intake_items where case_id in (select id from doomed_cases);
-- A hold is released before it is deleted: the release's trigger takes the image's hold_until back, a delete would not.
update public.media_holds set released_at = now() where case_id in (select id from doomed_cases) and released_at is null;
delete from public.media_holds where case_id in (select id from doomed_cases);
delete from public.case_access_log where case_id in (select id from doomed_cases);
delete from public.staff_texts where case_id in (select id from doomed_cases);
delete from public.evidence_snapshots where case_id in (select id from doomed_cases);
delete from public.cases where id in (select id from doomed_cases);
delete from public.intakes n
  where n.id in (select id from emptied_intakes) and not exists (select 1 from public.intake_items i where i.intake_id = n.id);
-- Now nothing retains the doomed accounts' image rows, and the keep trigger lets the cascade through.
delete from public.profiles where id in (select id from doomed);
delete from auth.users where id in (select id from doomed);
update public.profiles p set
    follower_count = (select count(*) from public.follows f where f.followee_id = p.id),
    following_count = (select count(*) from public.follows f where f.follower_id = p.id)
  where p.id in (select id from touched_profiles);
update public.posts p set
    like_count = (select count(*) from public.likes l where l.post_id = p.id),
    repost_count = (select count(*) from public.reposts r where r.post_id = p.id),
    reply_count = (select count(*) from public.posts c where c.reply_to_id = p.id and c.state <> 'deleted_by_author'),
    quote_count = (select count(*) from public.posts c where c.quote_of_id = p.id and c.state <> 'deleted_by_author')
  where p.id in (select id from touched_posts);
commit;
select 'deleted|yes';
${META}else
rollback;
${META}endif
SQL
`;

const run = spawnSync(compose[0], [...compose.slice(1), "exec", "-T", "-e", `PATTERN=${TEST_EMAIL}`, "-e", `DELETE=${yes ? "on" : "off"}`, "postgres", "sh", "-s"], {
  cwd: root,
  input: script,
  encoding: "utf8",
});
if (run.error) stop(`Could not run ${compose[0]}: ${run.error.message}`);
if (run.status !== 0) stop(`The database could not be read. Is the postgres service up?${NL}${run.stderr}`);

const report = new Map();
const listed = { account: [], profile: [] };
for (const line of run.stdout.split(NL).map((text) => text.trim())) {
  const bar = line.indexOf("|");
  if (bar === -1) continue;
  const key = line.slice(0, bar);
  if (key === "account-item") listed.account.push(line.slice(bar + 1));
  else if (key === "profile-item") listed.profile.push(line.slice(bar + 1));
  else report.set(key, line.slice(bar + 1));
}
const count = (key) => Number(report.get(key) ?? 0);

function show(title, key, labels) {
  console.log(`${title}: ${count(key)}`);
  for (const label of labels.slice(0, LISTED)) console.log(`  ${label}`);
  if (labels.length > LISTED) console.log(`  ... and ${labels.length - LISTED} more`);
}

console.log(`database ${report.get("database")}`);
show("accounts with a test email", "accounts", listed.account);
const KEPT_WHY = "they hold a staff key, decided a case, are linked to a staff account, are the subject of a decided case, or are named as staff by a moderation record that stays";
if (count("kept") > 0) console.log(`accounts with a test email kept because ${KEPT_WHY}: ${count("kept")}`);
show("profiles without an account", "profiles", listed.profile);
if (count("profiles_kept") > 0) console.log(`profiles without an account kept because ${KEPT_WHY}: ${count("profiles_kept")}`);
if (count("accounts") + count("profiles") === 0) {
  console.log("Nothing to clean.");
  process.exit(0);
}
console.log(`their posts: ${count("posts")}, image rows: ${count("images")}, undecided moderation cases about them: ${count("cases")}`);
console.log(`kept profiles and posts whose counters include them: ${count("touched_profiles")} and ${count("touched_posts")}`);
if (report.get("deleted") === "yes") {
  console.log(`Deleted ${count("accounts")} accounts and ${count("profiles")} profiles with everything they made, and ${count("cases")} undecided moderation cases about them; recomputed the counters of ${count("touched_profiles")} profiles and ${count("touched_posts")} posts.`);
  console.log("Their image files leave the store when the API's sweeper next finds them without a row, within about an hour.");
} else {
  console.log("Nothing was deleted. Run again with --yes to delete these.");
}
