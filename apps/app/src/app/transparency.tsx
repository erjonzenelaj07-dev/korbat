import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { ANNEX3_GROUNDS, ORDER_GROUNDS, PublicHead, PublicTransparency, type OrderFigures, type TransparencyFigures } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { TextLink } from "@/components/ui";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { PAGE_DOWN, TRANSPARENCY_PAGE, recipientsMonth } from "@/lib/public-pages";

const T = TRANSPARENCY_PAGE;
type Edition = PublicTransparency["editions"][number];
type Row = { label: string; count: string };

/** A heading of the page: level 2 a year or a fixed section, level 3 a table inside a year. */
function Heading({ level, children }: { level: 2 | 3; children: string }) {
  return (
    <Text accessibilityRole="header" aria-level={level} className={level === 2 ? "mt-8 text-lg font-semibold text-zinc-100" : "mt-5 text-base font-semibold text-zinc-100"}>
      {children}
    </Text>
  );
}
const Paragraph = ({ children }: { children: ReactNode }) => <Text className="mt-2 text-base leading-7 text-zinc-300">{children}</Text>;

/**
 * One table: its heading and its rows, each read as "label: value" and laid out as a block, never a chart (9.1); a table
 * with no row is its "none" sentence.
 */
function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <View>
      <Heading level={3}>{title}</Heading>
      {rows.length === 0 ? (
        <Paragraph>{T.tableNone}</Paragraph>
      ) : (
        <View role="list" aria-label={title}>
          {rows.map((row) => (
            <Text key={row.label} role="listitem" className="mt-1 text-base leading-6 text-zinc-300">
              {`${row.label}: ${row.count}`}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

/** A table's stored rows with the page's labels: `other` by the table's own word. */
const labelled = (rows: readonly { label: string; count: string }[], label: (key: string) => string, other: string): Row[] =>
  rows.map((row) => ({ label: row.label === "other" ? other : label(row.label), count: row.count }));

/** An order figure as the page prints it: a number, or "not recorded", never 0, for a figure the rows can no longer give. */
const figure = (n: number | null) => (n === null ? T.notRecorded : String(n));
const byGround = (grounds: readonly string[], counts: Record<string, number> | null) =>
  counts === null ? T.notRecorded : grounds.map((ground) => `${T.grounds[ground] ?? ground} ${counts[ground]}`).join(", ");

/**
 * The section on authorities' orders (9.3 item 4): [tr.orders], then the yearly report's headings with tco-counts'
 * figures as numbers, without the issuing state. It stands only in a year that has the section.
 */
function OrdersSection({ orders }: { orders: OrderFigures }) {
  const L = T.orderLines;
  const minutes = orders.minutes;
  const minutesList = minutes === null ? T.notRecorded : minutes.list.length === 0 ? "none" : minutes.list.map((n) => figure(n)).join(", ");
  return (
    <View>
      <Heading level={3}>{T.ordersHeading}</Heading>
      <Paragraph>{T.orders}</Paragraph>
      <Paragraph>{T.orderHeadings.received}</Paragraph>
      <Paragraph>{orders.received === null ? L.received(T.notRecorded, T.notRecorded) : L.received(String(orders.received.total), String(orders.received.crossBorder))}</Paragraph>
      <Paragraph>{T.orderHeadings.disabled}</Paragraph>
      <Paragraph>{L.itemsDisabled(figure(orders.itemsDisabled))}</Paragraph>
      <Paragraph>{L.minutes(minutesList)}</Paragraph>
      <Paragraph>{T.orderHeadings.late}</Paragraph>
      <Paragraph>{L.outside(minutes === null || minutes.withoutReceipt > 0 ? T.notRecorded : String(minutes.outside))}</Paragraph>
      <Paragraph>{L.open(minutes === null ? T.notRecorded : String(minutes.open))}</Paragraph>
      <Paragraph>{L.annex3(byGround(ANNEX3_GROUNDS, orders.annex3))}</Paragraph>
      <Paragraph>{T.orderHeadings.scrutiny}</Paragraph>
      <Paragraph>{orders.scrutiny === null ? L.scrutiny(T.notRecorded, T.notRecorded, T.notRecorded) : L.scrutiny(String(orders.scrutiny.requested), String(orders.scrutiny.annulled), String(orders.scrutiny.upheld))}</Paragraph>
      <Paragraph>{L.reinstated(byGround(ORDER_GROUNDS, orders.reinstated))}</Paragraph>
      <Paragraph>{T.orderHeadings.own}</Paragraph>
      <Paragraph>{L.terrorist(String(orders.terroristWithoutOrder))}</Paragraph>
      <Paragraph>{L.access(figure(orders.authorityAccess))}</Paragraph>
      <Paragraph>{L.referrals(String(orders.referralsClosed))}</Paragraph>
    </View>
  );
}

/** The tables of one version's figures, in W.2's order, then the order section, the standing sentence and the recipients. */
export function FiguresView({ year, figures }: { year: number; figures: TransparencyFigures }) {
  const r = figures.restrictions;
  const findings = labelled(figures.automated.findings, T.labels.findings, T.labels.other);
  const programs = [...findings, ...labelled(figures.automated.measures, T.labels.measures, T.labels.other)];
  const month = recipientsMonth(year);
  const recipients = figures.recipients;
  return (
    <View>
      <Table
        title={T.tables.byGround}
        rows={r.byGround.length === 0 ? [] : [...labelled(r.byGround, (key) => (key === "law" ? T.labels.law : T.labels.ground(key)), T.labels.otherGrounds), { label: T.labels.allRestrictions, count: r.total }]}
      />
      <Table title={T.tables.byMeasure} rows={labelled(r.byMeasure, T.labels.measure, T.labels.otherMeasures)} />
      <Table title={T.tables.noBreach} rows={[{ label: T.labels.noBreach, count: figures.noBreach }]} />
      <Table title={T.tables.intakes} rows={labelled(figures.intakes, (key) => T.labels.intakes[key] ?? key, T.labels.other)} />
      <Table title={T.tables.appeals} rows={labelled(figures.appeals, (key) => T.labels.appeals[key] ?? key, T.labels.other)} />
      <Table title={T.tables.reexaminations} rows={labelled(figures.reexaminations, (key) => T.labels.reexaminations[key] ?? key, T.labels.other)} />
      <Table title={T.tables.accountMeasures} rows={labelled(figures.accountMeasures, T.labels.measure, T.labels.otherMeasures)} />
      <Table title={T.tables.automated} rows={programs} />
      {figures.automated.r1 ? <Paragraph>{T.autoRate(figures.automated.r1.base, figures.automated.r1.restricted)}</Paragraph> : findings.length > 0 ? <Paragraph>{T.autoFew}</Paragraph> : null}
      {figures.uploads ? <Table title={T.tables.uploads} rows={labelled(figures.uploads, (key) => T.labels.uploads[key] ?? key, T.labels.other)} /> : null}
      {figures.orders ? <OrdersSection orders={figures.orders} /> : null}
      <Paragraph>{T.ordersHeld}</Paragraph>
      <Heading level={3}>{T.recipientsHeading}</Heading>
      <Paragraph>
        {recipients === "not recorded" ? T.recipientsNotYet : recipients.high === undefined ? T.recipientsOff(month, recipients.low) : T.recipients(month, recipients.low, recipients.high)}
      </Paragraph>
    </View>
  );
}

/** An older version of a year: its line, and its figures opened in place. */
function OlderVersion({ year, older }: { year: number; older: Edition["older"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Paragraph>{T.versionLine(older.version, older.publishedOn, older.replacedOn)}</Paragraph>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} className="mt-1 self-start">
        <Text className="text-sm text-sky-400 underline">{open ? T.hideVersion : T.showVersion}</Text>
      </Pressable>
      {open ? <FiguresView year={year} figures={older.figures} /> : null}
    </View>
  );
}

/** One year's section (9.3 item 2): its newest version, why that version was made, and its older versions. */
function EditionView({ edition, newest }: { edition: Edition; newest: boolean }) {
  return (
    <View>
      <Heading level={2}>{String(edition.year)}</Heading>
      <Paragraph>{T.edition(edition.year, edition.version, edition.publishedOn, edition.method)}</Paragraph>
      {edition.reason === "hold_ended" ? <Paragraph>{T.reason.hold_ended}</Paragraph> : null}
      {edition.reason === "correction" ? <Paragraph>{T.reason.correction(edition.publishedOn)}</Paragraph> : null}
      <FiguresView year={edition.year} figures={edition.figures} />
      {edition.older.length > 0 ? (
        <View>
          <Paragraph>{T.versions}</Paragraph>
          {edition.older.map((older) => (
            <OlderVersion key={older.version} year={edition.year} older={older} />
          ))}
        </View>
      ) : null}
      {newest ? <Paragraph>{T.method(edition.method)}</Paragraph> : null}
    </View>
  );
}

type HeadDay = PublicHead["days"][number];

/** A day before another, as the page prints a day. */
const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);

/** One line of the head's section: a published row, or a day between two shown days that has no head value. */
type HeadLine = { kind: "row"; row: HeadDay } | { kind: "missing"; day: string };

/**
 * The section's lines (9.3 item 6): the rows newest first as the route gives them, and [tr.headMissing] for each day
 * between the newest and the oldest shown day that has no head value, after that day's restore row when it has one. A
 * day after the newest row is not shown as missing: its value may not be published yet.
 */
export function headLines(days: readonly HeadDay[]): HeadLine[] {
  const lines: HeadLine[] = [];
  const valued = new Set(days.filter((row) => row.kind === "head").map((row) => row.day));
  const newest = days[0]?.day;
  const oldest = days.at(-1)?.day;
  if (newest === undefined || oldest === undefined) return lines;
  for (let day = newest; day >= oldest; day = dayBefore(day)) {
    for (const row of days) if (row.day === day) lines.push({ kind: "row", row });
    if (!valued.has(day)) lines.push({ kind: "missing", day });
  }
  return lines;
}

/** A day's proof saved as <day>.tsr: the token as the authority sent it, the TimeStampResp that openssl reads. */
function saveProof(day: string, token: string) {
  const bytes = Uint8Array.from(atob(token), (char) => char.charCodeAt(0));
  saveBlob(new Blob([bytes], { type: "application/timestamp-reply" }), `${day}.tsr`);
}

/**
 * Section 6, the audit log's daily value (3d design, section 9.3 item 6; W.2; Task 5): [tr.head], then a row a day,
 * newest first, with its value and who witnessed it, a restore's row with [tr.restore], a retired value with
 * [tr.retired] and a day without a value with [tr.headMissing]; while a shown row has a proof, [tr.verify] with the newest
 * such day's value and file, and each day's proof to download on the web. When the route did not answer, this part alone
 * reads [page.down]. The place is in no answer and on no row.
 */
function HeadSection({ head }: { head: PublicHead | "loading" | "down" }) {
  const T = TRANSPARENCY_PAGE;
  const witnessed = head === "loading" || head === "down" ? undefined : head.days.find((row) => row.token !== null);
  return (
    <View>
      <Heading level={2}>{T.headHeading}</Heading>
      <Paragraph>{T.head}</Paragraph>
      {head === "loading" ? null : head === "down" ? (
        <Paragraph>{PAGE_DOWN}</Paragraph>
      ) : head.days.length === 0 ? (
        <Paragraph>{T.headNone}</Paragraph>
      ) : (
        <View role="list" aria-label={T.headHeading}>
          {headLines(head.days).map((line) =>
            line.kind === "missing" ? (
              <Text key={`${line.day}-missing`} role="listitem" className="mt-1 text-base leading-6 text-zinc-300">
                {T.headMissingRow(line.day)}
              </Text>
            ) : (
              <View key={`${line.row.day}-${line.row.kind}`} role="listitem" className="mt-1">
                <Text className="break-all text-base leading-6 text-zinc-300">
                  {line.row.kind === "restore"
                    ? T.restore(line.row.day, line.row.lastDay)
                    : line.row.retiredOn === null
                      ? T.headRow(line.row.day, line.row.value, line.row.witness)
                      : `${T.headRow(line.row.day, line.row.value, line.row.witness)} ${T.retired(line.row.retiredOn)}`}
                </Text>
                {line.row.token !== null && Platform.OS === "web" ? (
                  <Pressable accessibilityRole="button" onPress={() => saveProof(line.row.day, line.row.token!)} className="mt-1 self-start">
                    <Text className="text-sm text-sky-400 underline">{T.download(line.row.day)}</Text>
                  </Pressable>
                ) : null}
              </View>
            ),
          )}
        </View>
      )}
      {witnessed ? <Paragraph>{T.verify(witnessed.value, witnessed.day)}</Paragraph> : null}
    </View>
  );
}

/**
 * The transparency page as it reads with the editions and the head's values it was given (3d design, section 9.3; W.2).
 * It shows what the stored editions hold and never a live count: no year section for the running year, and [tr.none]
 * while no edition exists. When a route did not answer, the fixed texts stand and that route's part alone reads
 * [page.down].
 */
export function TransparencyView({ answer, head = "loading" }: { answer: PublicTransparency | "loading" | "down"; head?: PublicHead | "loading" | "down" }) {
  return (
    <View>
      <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
        {T.title}
      </Text>
      <Paragraph>{T.lead}</Paragraph>
      <Paragraph>{T.read}</Paragraph>
      {answer === "loading" ? null : answer === "down" ? (
        <Paragraph>{PAGE_DOWN}</Paragraph>
      ) : answer.editions.length === 0 ? (
        <Paragraph>{T.none}</Paragraph>
      ) : (
        answer.editions.map((edition, index) => <EditionView key={edition.year} edition={edition} newest={index === 0} />)
      )}
      <HeadSection head={head} />
      <Heading level={2}>{T.tdbHeading}</Heading>
      <Paragraph>{T.tdb}</Paragraph>
      <TextLink label={T.rulesLink} href="/rules" />
      <TextLink label={T.exploreLink} href="/explore/about" />
    </View>
  );
}

/**
 * /transparency (3d design, sections 9.1 and 9.3), public, signed in or out: it reads no session for its content and
 * sends two GETs, /api/public/transparency and (Task 5) /api/public/head, each of which may be an hour old: nothing in
 * them changes within a day. Each fails alone: the other part still shows.
 */
export default function TransparencyPage() {
  const [answer, setAnswer] = useState<PublicTransparency | "loading" | "down">("loading");
  const [head, setHead] = useState<PublicHead | "loading" | "down">("loading");
  useEffect(() => {
    let live = true;
    api("/api/public/transparency", { schema: PublicTransparency })
      .then((read) => {
        if (live) setAnswer(read);
      })
      .catch(() => {
        if (live) setAnswer("down");
      });
    api("/api/public/head", { schema: PublicHead })
      .then((read) => {
        if (live) setHead(read);
      })
      .catch(() => {
        if (live) setHead("down");
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 pb-16 pt-6">
        <View className="w-full max-w-xl">
          <TransparencyView answer={answer} head={head} />
        </View>
      </ScrollView>
    </AppShell>
  );
}
