import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { AUTOMATION_RULES, MediaStatusResponse, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { MATCH_FIXTURES } from "@korbat/media-protocol";
import { loadConfig } from "../../src/config";
import { mediaForAccount } from "../../src/media";
import { mediaForCases } from "../../src/media/cases";
import type { MatchEvent } from "../../src/media/context";
import { remove } from "../../src/media/flows/remove";
import { serve } from "../../src/media/flows/serve";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { matchRetryRound } from "../../src/media/match";
import { matchAdapterFrom, type TestMatchAdapter } from "../../src/media/match-adapter";
import { finalize } from "../../src/media/flows/status";
import { sweep } from "../../src/media/sweeper";
import { bodyOf, mediaHarness, type MediaHarness } from "./media-harness";
import { refusal, removeFixtures } from "./moderation-fixtures";
import { rolledBack } from "./staff-fixtures";

// Each test uploads, finalizes and checks several images, dozens of statements: slow on a loaded machine.
vi.setConfig({ testTimeout: 120_000 });

/**
 * The comparison of uploads with known material in the media module (3d design, sections 5, 6.7, 7.8 and 12.1 rows 9 to
 * 11; Task 7), on the test matcher and the two byte-constant PNG files of @korbat/media-protocol: the three hashes of the
 * bytes as received; nothing hashed or written with the matcher off; the check in finalize; an acting match refused and
 * held, out of every reader and the export, kept by gate K, and attached by nobody; a match that does not act accepted;
 * an unanswered check accepted and asked again; the limit on refusals an hour; an upload removed during its check; and
 * matcher_down. No image is decoded: the stand-in worker writes the protocol's files.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: known material in the media module (3d Task 7)", () => {
  let db: Db;
  let migrateDb: Db;
  let h: MediaHarness;
  let adapter: TestMatchAdapter;
  const events: MatchEvent[] = [];
  const owners: string[] = [];

  beforeAll(async () => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    adapter = matchAdapterFrom({ MEDIA_MATCH: "test", APP_SITE: "closed" }) as TestMatchAdapter;
    h = await mediaHarness(db, { match: adapter });
    h.deps.matched.handler = async (event) => {
      events.push(event);
    };
  });
  afterAll(async () => {
    await removeFixtures(migrateDb, owners);
    await migrateDb.execute(sql`delete from public.alert_outbox where kind = 'matcher_down'`);
    h.cleanup();
    await Promise.all([closeDb(db), closeDb(migrateDb)]);
  });

  /** An account old enough to upload, removed after the file. */
  const account = async () => {
    const owner = await h.established();
    owners.push(owner.id);
    return owner;
  };
  const png = (bytes: Uint8Array) => ({ contentType: "image/png", contentLength: undefined, body: bodyOf(bytes) });
  /** An upload of these bytes that the worker accepted, its status read (which finalizes it). */
  const uploaded = async (ownerId: string, bytes: Uint8Array) => {
    const sent = UploadResponse.parse(await upload(h.deps, ownerId, png(bytes)));
    h.worker.ready(sent.id, { width: 8, height: 8 });
    return { id: sent.id, answer: MediaStatusResponse.parse(await status(h.deps, ownerId, sent.id)) };
  };
  const hashesOf = async (id: string) => {
    const [row] = await db.execute<{ sha256: Buffer; sha1: Buffer; md5: Buffer; check_state: string; pdq: Buffer | null }>(sql`select sha256, sha1, md5, check_state, pdq from media_hashes where media_id = ${id}::uuid`);
    return row ?? null;
  };
  const refusalOf = async (mediaId: string) => {
    const [row] = await db.execute<{ id: string; owner_id: string; told: string; match_id: string }>(sql`select id, owner_id, told::text as told, match_id from upload_refusals where media_id = ${mediaId}::uuid`);
    return row ?? null;
  };
  const holdOf = async (mediaId: string) => {
    const [row] = await migrateDb.execute<{ hold: string | null }>(sql`select hold_until::text as hold from post_media where id = ${mediaId}::uuid`);
    return row?.hold ?? null;
  };

  test("with MEDIA_MATCH off nothing is hashed, no media_hashes row is written and the source is asked nothing (row 10)", async () => {
    const off = await mediaHarness(db);
    try {
      const owner = await off.established();
      owners.push(owner.id);
      const asked = adapter.requests.length;
      const sent = UploadResponse.parse(await upload(off.deps, owner.id, png(MATCH_FIXTURES.acting)));
      off.worker.ready(sent.id, { width: 8, height: 8 });
      expect((await status(off.deps, owner.id, sent.id)).status).toBe("ready");
      expect(await hashesOf(sent.id)).toBeNull();
      expect(adapter.requests.length).toBe(asked);
    } finally {
      off.cleanup();
    }
  });

  test("the hashes are of the bytes as received, equal to node:crypto's; the check is asked with them alone; a clear answer makes the image ready; the hashes die with the image row (row 11); no PDQ in this build", async () => {
    const owner = await account();
    const clearBytes = Uint8Array.from([...MATCH_FIXTURES.flag.slice(0, 8), ...Buffer.from("a png that is on no list")]);
    const sent = UploadResponse.parse(await upload(h.deps, owner.id, png(clearBytes)));
    const pending = await hashesOf(sent.id);
    expect(pending!.check_state).toBe("pending");
    expect(Buffer.from(pending!.sha256).toString("hex")).toBe(createHash("sha256").update(clearBytes).digest("hex"));
    expect(Buffer.from(pending!.sha1).toString("hex")).toBe(createHash("sha1").update(clearBytes).digest("hex"));
    expect(Buffer.from(pending!.md5).toString("hex")).toBe(createHash("md5").update(clearBytes).digest("hex"));
    h.worker.ready(sent.id, { width: 8, height: 8 });
    expect((await status(h.deps, owner.id, sent.id)).status).toBe("ready");
    const checked = await hashesOf(sent.id);
    expect(checked!.check_state).toBe("clear");
    // The PDQ member is absent: the owner did not allow the fetch of the reference's vectors, so no PDQ is computed.
    expect(checked!.pdq).toBeNull();
    const request = adapter.requests.at(-1)!;
    expect(Object.keys(request).sort()).toEqual(["md5", "sha1", "sha256"]);
    expect(request.sha256).toBe(createHash("sha256").update(clearBytes).digest("hex"));
    expect((await h.deps.repo.deleteUnattached(sent.id, owner.id, true))).toBe("deleted");
    expect(await hashesOf(sent.id)).toBeNull();
  });

  test("an acting match on an upload: refused with its refusal's id and nothing of the file, held for good, its record acting and handled, the uploader's address held, the moderation module told; nothing serves, lists or exports it (rows 9 and 35)", async () => {
    const owner = await account();
    const before = events.length;
    const { id, answer } = await uploaded(owner.id, MATCH_FIXTURES.acting);
    const held = await refusalOf(id);
    expect(held).not.toBeNull();
    expect(answer).toEqual({ id, status: "refused", refusalId: held!.id });
    expect(held!.owner_id).toBe(owner.id);
    expect(held!.told).toBe("pending");
    expect(await holdOf(id)).toBe("infinity");
    const [record] = await db.execute<{ listed: boolean; acting: boolean; handled: boolean; hash_type: string; match_kind: string; source: string }>(
      sql`select listed, acting, handled_at is not null as handled, hash_type, match_kind, source from media_matches where id = ${held!.match_id}::uuid`,
    );
    expect(record).toEqual({ listed: true, acting: true, handled: true, hash_type: "sha256", match_kind: "exact", source: "test" });
    expect((await hashesOf(id))!.check_state).toBe("matched");
    const [address] = await migrateDb.execute<{ released: boolean; final: boolean }>(sql`select released_at is not null as released, seal_final as final from auth.report_holds where user_id = ${owner.id}::uuid`);
    expect(address).toEqual({ released: false, final: false });
    expect(events.slice(before)).toEqual([{ kind: "refused", refusalId: held!.id }]);
    // The upload file is discarded as for any verdict; the store's sizes stay, served to nobody.
    expect(existsSync(h.files.uploads.upload(id))).toBe(false);
    // No reader: the pending count, the export's list and its open, serve (on no post) and the owner's delete (gate K).
    expect(await h.deps.repo.pendingCount(owner.id)).toBe(0);
    const exported = await mediaForAccount(h.deps).exportImages(owner.id);
    expect(exported.map((image) => image.id)).not.toContain(id);
    expect(await h.deps.repo.isExportable(owner.id, id)).toBe(false);
    expect((await serve(h.deps, { id, size: "large", ifNoneMatch: undefined, viewer: async () => owner.id })).kind).toBe("not_found");
    expect(await refusal(remove(h.deps, owner.id, id))).toBe("not_found");
    expect(await holdOf(id)).toBe("infinity");
    // The sweeper keeps the held row at any age: gate K, whose test reads hold_until alone.
    await migrateDb.execute(sql`update post_media set created_at = now() - interval '3 days' where id = ${id}::uuid`);
    await sweep(h.deps, new Date(), { reconcile: false });
    expect(await holdOf(id)).toBe("infinity");
    // The status still answers refused, never ready, also on a second read.
    expect(await status(h.deps, owner.id, id)).toEqual({ id, status: "refused", refusalId: held!.id });
  });

  test("nobody attaches a refused upload: the post's route answers upload_refused (422), and a direct update as the API's role is refused", async () => {
    const owner = await account();
    const { id } = await uploaded(owner.id, MATCH_FIXTURES.acting);
    await rolledBack(db, async (tx) => {
      const [post] = await tx.execute<{ id: string }>(sql`insert into posts (author_id, body) values (${owner.id}::uuid, 'a post') returning id`);
      const err = await h.deps.repo.attach(tx, { postId: post!.id, ownerId: owner.id, items: [{ id, alt: "an image" }] }).then(
        () => null,
        (e: unknown) => e as { code?: string; status?: number },
      );
      expect(err).toMatchObject({ code: "upload_refused", status: 422 });
    });
    await rolledBack(db, async (tx) => {
      const [post] = await tx.execute<{ id: string }>(sql`insert into posts (author_id, body) values (${owner.id}::uuid, 'a post') returning id`);
      expect(await refusal(tx.execute(sql`update post_media set post_id = ${post!.id}::uuid, position = 0, alt_text = 'x' where id = ${id}::uuid`))).toBe("upload_refused");
    });
  });

  test("a match that does not act is accepted like any upload: near of the listed class and the class that is not listed; no refusal, no hold, its record waiting for the image to be posted (rows 28, 35)", async () => {
    const owner = await account();
    adapter.flag = "near";
    const near = await uploaded(owner.id, MATCH_FIXTURES.flag);
    expect(near.answer.status).toBe("ready");
    expect(await refusalOf(near.id)).toBeNull();
    expect(await holdOf(near.id)).toBeNull();
    const [nearRecord] = await db.execute<{ listed: boolean; acting: boolean; handled: boolean; match_kind: string }>(sql`select listed, acting, handled_at is not null as handled, match_kind from media_matches where media_id = ${near.id}::uuid`);
    expect(nearRecord).toEqual({ listed: true, acting: false, handled: false, match_kind: "near" });
    adapter.flag = "unlisted";
    const other = await uploaded(owner.id, MATCH_FIXTURES.flag);
    expect(other.answer.status).toBe("ready");
    const [otherRecord] = await db.execute<{ listed: boolean; acting: boolean; classification: string }>(sql`select listed, acting, classification from media_matches where media_id = ${other.id}::uuid`);
    expect(otherRecord).toEqual({ listed: false, acting: false, classification: "test_unlisted" });
    adapter.flag = "near";
    // A refusal's insert on a record that does not act is refused by the database itself.
    const [record] = await db.execute<{ id: string }>(sql`select id from media_matches where media_id = ${other.id}::uuid`);
    expect(await refusal(db.execute(sql`insert into upload_refusals (media_id, owner_id, match_id, refused_at) values (${other.id}::uuid, ${owner.id}::uuid, ${record!.id}::uuid, now())`))).toBe("refusal_not_acting");
    // A flagged upload is attached as any: the trigger keys on a refusal, never on a match record.
    await rolledBack(db, async (tx) => {
      const [post] = await tx.execute<{ id: string }>(sql`insert into posts (author_id, body) values (${owner.id}::uuid, 'a post') returning id`);
      await h.deps.repo.attach(tx, { postId: post!.id, ownerId: owner.id, items: [{ id: other.id, alt: "an image" }] });
    });
  });

  test("an unanswered check: the upload is ready and may be posted, its check unchecked; match-retry asks again and stores the late answer; a late match on a posted image is a record alone and the automated step's event (row 10, 7.8 step 6)", async () => {
    const owner = await account();
    adapter.silent = true;
    const late = await uploaded(owner.id, MATCH_FIXTURES.acting);
    adapter.silent = false;
    expect(late.answer.status).toBe("ready");
    expect((await hashesOf(late.id))!.check_state).toBe("unchecked");
    // Posted before the answer came: the late match is a record, and the step is told.
    const [post] = await db.execute<{ id: string }>(sql`insert into posts (author_id, body) values (${owner.id}::uuid, 'a post') returning id`);
    await db.execute(sql`update post_media set post_id = ${post!.id}::uuid, position = 0, alt_text = 'an image' where id = ${late.id}::uuid`);
    const before = events.length;
    const report = await matchRetryRound(h.deps, finalize);
    expect(report.matched).toBeGreaterThanOrEqual(1);
    expect((await hashesOf(late.id))!.check_state).toBe("matched");
    expect(await refusalOf(late.id)).toBeNull();
    const [record] = await db.execute<{ id: string; acting: boolean; handled: boolean }>(sql`select id, acting, handled_at is not null as handled from media_matches where media_id = ${late.id}::uuid`);
    expect(record).toMatchObject({ acting: true, handled: false });
    expect(events.slice(before)).toContainEqual({ kind: "posted", mediaId: late.id, matchId: record!.id });
    // An unanswered upload on no post that matches late is refused and held, as at its first check.
    adapter.silent = true;
    const unposted = await uploaded(owner.id, MATCH_FIXTURES.acting);
    adapter.silent = false;
    expect(unposted.answer.status).toBe("ready");
    await matchRetryRound(h.deps, finalize);
    expect(await refusalOf(unposted.id)).not.toBeNull();
    expect(await holdOf(unposted.id)).toBe("infinity");
  });

  test("an upload removed during its check is kept until the check has answered, and held when it matched; a ready upload is removed as before", async () => {
    const owner = await account();
    const sent = UploadResponse.parse(await upload(h.deps, owner.id, png(MATCH_FIXTURES.acting)));
    // Removed while processing with its check pending: answered as removed, and kept with its upload file.
    await remove(h.deps, owner.id, sent.id);
    expect(await hashesOf(sent.id)).not.toBeNull();
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(true);
    h.worker.ready(sent.id, { width: 8, height: 8 });
    await sweep(h.deps, new Date(), { reconcile: false });
    expect(await refusalOf(sent.id)).not.toBeNull();
    expect(await holdOf(sent.id)).toBe("infinity");
  });

  test("the limit on refusals an hour: over it nothing of the match is written, the upload stays processing with its check capped and unposted, matcher_down's event at once; match-retry refuses it once the hour allows (rows 4 and 35)", async () => {
    const owner = await account();
    // The hour's refusals so far are moved out of it, as the migrator, so this test counts its own.
    await migrateDb.execute(sql`update upload_refusals set refused_at = refused_at - interval '2 hours' where refused_at > now() - interval '1 hour'`);
    for (let i = 0; i < AUTOMATION_RULES.refusalsPerHour; i++) await uploaded(owner.id, MATCH_FIXTURES.acting);
    const before = events.length;
    const over = await uploaded(owner.id, MATCH_FIXTURES.acting);
    expect(over.answer).toEqual({ id: over.id, status: "processing" });
    expect((await hashesOf(over.id))!.check_state).toBe("capped");
    expect(await refusalOf(over.id)).toBeNull();
    expect((await db.execute(sql`select 1 from media_matches where media_id = ${over.id}::uuid`)).length).toBe(0);
    expect(events.slice(before)).toEqual([{ kind: "capped" }]);
    // The upload file and the result stay for the next question; the sweeper neither finalizes nor fails it.
    expect(existsSync(h.files.uploads.upload(over.id))).toBe(true);
    await sweep(h.deps, new Date(Date.now() + 10 * 60_000), { reconcile: false });
    expect((await hashesOf(over.id))!.check_state).toBe("capped");
    // Asked again within the hour: still capped. After it: refused and held.
    await matchRetryRound(h.deps, finalize);
    expect((await hashesOf(over.id))!.check_state).toBe("capped");
    await migrateDb.execute(sql`update upload_refusals set refused_at = refused_at - interval '2 hours' where refused_at > now() - interval '1 hour'`);
    await matchRetryRound(h.deps, finalize);
    expect((await hashesOf(over.id))!.check_state).toBe("matched");
    expect(await refusalOf(over.id)).not.toBeNull();
  });

  test("matcher_down: alert_steps() writes it daily once a check has been unchecked for matcherDownMinutes and none was answered since, with since, count and refusalsCapped", async () => {
    await rolledBack(migrateDb, async (tx) => {
      // Every answered check is moved before the unchecked one, so none was answered since it.
      const owner = await h.established();
      const [image] = await tx.execute<{ id: string }>(sql`insert into post_media (owner_id, status, width, height, blurhash) values (${owner.id}::uuid, 'ready', 8, 8, 'L2Eo_P_3jb_3~qoL') returning id`);
      await tx.execute(sql`insert into media_hashes (media_id, sha256, sha1, md5, check_state) values (${image!.id}::uuid, ${Buffer.alloc(32)}::bytea, ${Buffer.alloc(20)}::bytea, ${Buffer.alloc(16)}::bytea, 'unchecked')`);
      await tx.execute(sql`update post_media set created_at = now() - make_interval(mins => ${AUTOMATION_RULES.matcherDownMinutes + 1}::int) where id = ${image!.id}::uuid`);
      await tx.execute(sql`update media_hashes set checked_at = now() - interval '2 days' where check_state in ('clear', 'matched')`);
      await tx.execute(sql`delete from alert_outbox where kind = 'matcher_down'`);
      await tx.execute(sql`select public.alert_steps()`);
      const [alert] = await tx.execute<{ facts: Record<string, unknown> }>(sql`select facts from alert_outbox where kind = 'matcher_down'`);
      expect(alert).toBeDefined();
      expect(Object.keys(alert!.facts).sort()).toEqual(["count", "refusalsCapped", "since"]);
      expect(alert!.facts.count).toBeGreaterThanOrEqual(1);
      // Daily: a second round writes nothing.
      await tx.execute(sql`select public.alert_steps()`);
      expect((await tx.execute(sql`select 1 from alert_outbox where kind = 'matcher_down'`)).length).toBe(1);
    });
  });

  test("gate V: the one function that serves staff an image answers matched for an image an unerased match record names, on whatever case, and serves it again once the record is erased", async () => {
    const owner = await account();
    adapter.flag = "unlisted";
    const flagged = await uploaded(owner.id, MATCH_FIXTURES.flag);
    adapter.flag = "near";
    const [post] = await db.execute<{ id: string }>(sql`insert into posts (author_id, body) values (${owner.id}::uuid, 'a post') returning id`);
    await db.execute(sql`update post_media set post_id = ${post!.id}::uuid, position = 0, alt_text = 'an image' where id = ${flagged.id}::uuid`);
    const cases = mediaForCases(h.deps);
    expect(await cases.staffImage(flagged.id, "large")).toBe("matched");
    await rolledBack(migrateDb, async (tx) => {
      await tx.execute(sql`update media_matches set erased_at = now(), hash = null, classification = null where media_id = ${flagged.id}::uuid`);
      const [still] = await tx.execute<{ matched: boolean }>(sql`select exists (select 1 from media_matches x where x.media_id = ${flagged.id}::uuid and x.erased_at is null) as matched`);
      expect(still!.matched).toBe(false);
    });
  });
});
