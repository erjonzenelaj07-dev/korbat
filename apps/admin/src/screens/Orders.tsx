import {
  ANNEX3_GROUND_LABELS,
  EU_MEMBER_STATES,
  ORDER_CHANNELS,
  ORDER_CHANNEL_LABELS,
  ORDER_GROUND_LABELS,
  ORDER_KINDS,
  ORDER_KIND_LABELS,
  ORDER_RULES,
  OrderOpenRequest,
  STATE_FACTS,
  type ContactMessage,
  type MemberState,
  type OrderChannel,
  type OrderKind,
  type OrderSummary,
  type OrderView,
  type OrdersPage,
  type StaffMe,
} from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiError, type StaffApi } from "../api";
import { describeError, ORDER_WORDS } from "../messages";
import { OrderLink } from "../nav";
import { parseOrderId, type OrderId } from "../router";
import { bothTimes, Loaded, UserText, type Loadable } from "../ui";

/**
 * Orders (3f design, section 8.4): the orders that are not closed, the nearest deadline first, then those closed in the
 * last 30 days, each a block with its kind, the issuing state, the authority and the reference in their frame (an
 * outsider's words, drawn as such), one clock line and a link to its page; and the form "Open an order", which restricts
 * nothing, copies nothing and tells no author, so it needs no key. The list reads again every 20 seconds without the mark.
 */

const W = ORDER_WORDS;
const MIN = 60_000;

/** Whole minutes from now to an instant, never below zero. */
const minutesTo = (iso: string, now: number) => Math.max(0, Math.ceil((Date.parse(iso) - now) / MIN));

/** An order's clock line (8.4's table), from its summary alone. */
export function clockLine(order: OrderSummary, now: number): string {
  if (order.closedAt !== null) return order.closeGround === null ? W.clock.closed(bothTimes(order.closedAt)) : W.clock.closedGround(bothTimes(order.closedAt), ORDER_GROUND_LABELS[order.closeGround]);
  const clock = order.clock;
  if (order.kind !== "tco_removal" || clock === null) return order.dueAt === null ? W.clock.dsaNone : W.clock.dsaDue(bothTimes(order.dueAt));
  if (order.state === "given_effect" && clock.lastEffectAt !== null) {
    const elapsed = clock.clockStart === null ? 0 : Math.round((Date.parse(clock.lastEffectAt) - Date.parse(clock.clockStart)) / MIN);
    // An effect given while the clock was stopped is inside its hour; the view says so with within_hour true and no deadline.
    const whileStopped = clock.withinHour === true && clock.clockStart !== null && Date.parse(clock.lastEffectAt) > Date.parse(clock.clockStart) + ORDER_RULES.hourMinutes * MIN;
    return W.clock.effect(bothTimes(clock.lastEffectAt), elapsed, clock.withinHour, whileStopped);
  }
  if (clock.stopped) return W.clock.stopped(clock.stoppedAt === null ? "" : bothTimes(clock.stoppedAt), clock.stopGround === null ? "" : ANNEX3_GROUND_LABELS[clock.stopGround]);
  if (clock.clockStart === null || clock.deadlineAt === null) return W.orders.deadlineUnknown;
  const done = order.items - clock.itemsOpen;
  if (Date.parse(clock.deadlineAt) < now) return W.clock.overdue(bothTimes(clock.deadlineAt), clock.itemsOpen, order.items);
  if (clock.firstEffectAt !== null && clock.itemsOpen > 0) return W.clock.partial(done, order.items, bothTimes(clock.firstEffectAt), clock.itemsOpen, bothTimes(clock.deadlineAt));
  return W.clock.running(bothTimes(clock.deadlineAt), minutesTo(clock.deadlineAt, now), clock.targetAt === null ? "" : bothTimes(clock.targetAt));
}

/** The authority and the reference, in the frame of an outsider's words, with the kind and the issuing state. */
export function OrderFacts({ order }: { order: Pick<OrderSummary, "kind" | "memberState" | "authority" | "reference"> }) {
  return (
    <>
      <p>{ORDER_KIND_LABELS[order.kind]}</p>
      <p>{W.orders.state(`${EU_MEMBER_STATES[order.memberState]} (${order.memberState})`)}</p>
      <figure className="frame">
        <figcaption>{W.orders.frame}</figcaption>
        <p>
          <UserText>{order.authority}</UserText>
        </p>
        <p>
          <UserText>{order.reference}</UserText>
        </p>
      </figure>
    </>
  );
}

/** One order's block on the list. */
function OrderBlock({ order, now, onOpenOrder }: { order: OrderSummary; now: number; onOpenOrder(id: OrderId): void }) {
  const id = parseOrderId(order.id);
  return (
    <li className="block">
      <OrderFacts order={order} />
      <p className={order.state === "overdue" || order.state === "unknown_deadline" ? "error" : undefined}>{clockLine(order, now)}</p>
      {id !== null ? (
        <OrderLink id={id} onOpen={onOpenOrder}>
          {W.orders.openLink}
        </OrderLink>
      ) : null}
    </li>
  );
}

/** The list (8.4): the open orders, then those closed in the last 30 days. */
export function OrdersList({ page, now, onOpenOrder }: { page: OrdersPage; now: number; onOpenOrder(id: OrderId): void }) {
  return (
    <>
      {page.open.length === 0 && page.closed.length === 0 ? <p>{W.orders.empty}</p> : null}
      {page.open.length > 0 ? (
        <ul className="blocks orders">
          {page.open.map((order) => (
            <OrderBlock key={order.id} order={order} now={now} onOpenOrder={onOpenOrder} />
          ))}
        </ul>
      ) : null}
      {page.closed.length > 0 ? (
        <>
          <h3>{W.orders.closedTitle}</h3>
          <ul className="blocks orders">
            {page.closed.map((order) => (
              <OrderBlock key={order.id} order={order} now={now} onOpenOrder={onOpenOrder} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/** The form's three answers to "Must the author not be told?": none is preselected, and "I cannot tell" holds like a tick. */
type SectionCChoice = "yes" | "no" | "unsure";

/** What the form holds while it is filled in. */
export interface OrderFormState {
  /** A message's id, "none" for "The message is not listed", or null while nothing is picked. */
  message: string | null;
  channel: OrderChannel | null;
  kind: OrderKind | null;
  memberState: MemberState | null;
  /** An authority's id from the state's facts, "other", or null. */
  authorityChoice: string | null;
  otherAuthority: string;
  reference: string;
  links: string;
  sectionC: SectionCChoice | null;
  emergency: boolean;
  withhold: boolean;
}

export const emptyOrderForm = (message: string | null = null): OrderFormState => ({
  message,
  channel: null,
  kind: null,
  memberState: null,
  authorityChoice: null,
  otherAuthority: "",
  reference: "",
  links: "",
  sectionC: null,
  emergency: false,
  withhold: false,
});

/** The member states, the home state first, then by name. */
function statesInOrder(home: MemberState | null): MemberState[] {
  const all = (Object.keys(EU_MEMBER_STATES) as MemberState[]).sort((a, b) => EU_MEMBER_STATES[a].localeCompare(EU_MEMBER_STATES[b]));
  return home === null ? all : [home, ...all.filter((code) => code !== home)];
}

/**
 * The request the form sends, or the reason it is not sent: Section C untouched is never sent, and the request is held
 * to the contracts' schema, which refuses a held notice on a post its author sees.
 */
export function orderRequest(form: OrderFormState): { ok: true; request: OrderOpenRequest } | { ok: false; problem: string } {
  if (form.sectionC === null) return { ok: false, problem: W.form.untouched };
  const facts = form.memberState === null ? undefined : STATE_FACTS[form.memberState];
  const authority = form.authorityChoice === "other" ? form.otherAuthority : (facts?.authorities.find((a) => a.id === form.authorityChoice)?.name ?? "");
  const sectionC = form.sectionC !== "no";
  const kind = form.kind;
  const withhold = kind === "tco_removal" || sectionC || (kind === "dsa_art9" && form.withhold);
  const parsed = OrderOpenRequest.safeParse({
    messageId: form.message === null || form.message === "none" ? null : form.message,
    channel: form.message !== null && form.message !== "none" ? "mailbox" : form.channel,
    kind,
    memberState: form.memberState,
    authority,
    reference: form.reference,
    links: kind === "dsa_art10" ? [] : form.links.split(String.fromCharCode(10)).map((line) => line.trim()).filter((line) => line !== ""),
    sectionC,
    emergency: kind === "tco_removal" && form.emergency,
    withholdFromAuthor: withhold,
  });
  if (!parsed.success) return { ok: false, problem: describeError(new ApiError(0, "invalid_request")) };
  return { ok: true, request: parsed.data };
}

export interface OrderFormProps {
  me: Pick<StaffMe, "homeState">;
  form: OrderFormState;
  /** The messages not handled, then those handled in the last 24 hours, for the form's list. */
  messages: ContactMessage[];
  busy: boolean;
  problem: string | null;
  /** The order that stands when the API answered order_exists. */
  duplicate: OrderId | null;
  onChange(form: OrderFormState): void;
  onSubmit(): void;
  onOpenOrder(id: OrderId): void;
}

/** The form "Open an order" (8.4's table). Nothing is preselected that decides anything for a person. */
export function OrderForm({ me, form, messages, busy, problem, duplicate, onChange, onSubmit, onOpenOrder }: OrderFormProps) {
  const set = (patch: Partial<OrderFormState>) => onChange({ ...form, ...patch });
  const facts = form.memberState === null ? undefined : STATE_FACTS[form.memberState];
  const tco = form.kind === "tco_removal";
  const locked = form.sectionC !== "no";
  const choices = form.kind === "dsa_art9" ? W.form.sectionCChoices.dsa : W.form.sectionCChoices.tco;
  return (
    <form
      className="order-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h3>{W.form.title}</h3>
      <fieldset>
        <legend>{W.form.message}</legend>
        <p className="hint">{W.form.openMessage}</p>
        <ul className="choices">
          {messages.map((message) => (
            <li key={message.id}>
              <label className="choice">
                <input type="radio" name="order-message" checked={form.message === message.id} onChange={() => set({ message: message.id })} />
                {`${W.contact.received(bothTimes(message.receivedAt))}, ${W.contact.folders[message.folder]}`}
              </label>
            </li>
          ))}
          <li>
            <label className="choice">
              <input type="radio" name="order-message" checked={form.message === "none"} onChange={() => set({ message: "none" })} />
              {W.form.notListed}
            </label>
          </li>
        </ul>
        {form.message === "none" ? <p className="notice">{W.form.noMessage}</p> : null}
      </fieldset>
      {form.message === "none" ? (
        <fieldset>
          <legend>{W.form.channel}</legend>
          <p className="hint">{W.form.channelHint}</p>
          <ul className="choices">
            {ORDER_CHANNELS.map((channel) => (
              <li key={channel}>
                <label className="choice">
                  <input type="radio" name="order-channel" checked={form.channel === channel} onChange={() => set({ channel })} />
                  {ORDER_CHANNEL_LABELS[channel]}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      <fieldset>
        <legend>{W.form.kind}</legend>
        <p className="hint">{W.form.kindHint}</p>
        <ul className="choices">
          {ORDER_KINDS.map((kind) => (
            <li key={kind}>
              <label className="choice">
                <input type="radio" name="order-kind" checked={form.kind === kind} onChange={() => set({ kind })} />
                {ORDER_KIND_LABELS[kind]}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <label className="field">
        {W.form.state}
        <select value={form.memberState ?? ""} onChange={(event) => set({ memberState: (event.target.value || null) as MemberState | null, authorityChoice: null })}>
          <option value="">-</option>
          {statesInOrder((me.homeState as MemberState | null) ?? null).map((code) => (
            <option key={code} value={code}>
              {`${EU_MEMBER_STATES[code]} (${code})`}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>{W.form.authority}</legend>
        <p className="hint">{W.form.authorityHint}</p>
        <ul className="choices">
          {(facts?.authorities ?? []).map((authority) => (
            <li key={authority.id}>
              <label className="choice">
                <input type="radio" name="order-authority" checked={form.authorityChoice === authority.id} onChange={() => set({ authorityChoice: authority.id })} />
                {authority.name}
              </label>
            </li>
          ))}
          <li>
            <label className="choice">
              <input type="radio" name="order-authority" checked={form.authorityChoice === "other"} onChange={() => set({ authorityChoice: "other" })} />
              {W.form.otherAuthority}
            </label>
          </li>
        </ul>
        {form.authorityChoice === "other" ? <input type="text" aria-label={W.form.otherAuthority} value={form.otherAuthority} maxLength={400} onChange={(event) => set({ otherAuthority: event.target.value })} /> : null}
      </fieldset>
      <label className="field">
        {W.form.reference}
        <input type="text" value={form.reference} maxLength={400} onChange={(event) => set({ reference: event.target.value })} />
        <span className="hint">{W.form.referenceHint}</span>
      </label>
      {form.kind !== "dsa_art10" ? (
        <label className="field">
          {W.form.links}
          <textarea value={form.links} rows={4} onChange={(event) => set({ links: event.target.value })} />
          <span className="hint">{W.form.linksHint}</span>
        </label>
      ) : null}
      <fieldset>
        <legend>{W.form.sectionC}</legend>
        <ul className="choices">
          {(["yes", "no", "unsure"] as const).map((value, index) => (
            <li key={value}>
              <label className="choice">
                <input type="radio" name="order-section-c" checked={form.sectionC === value} onChange={() => set({ sectionC: value })} />
                {choices[index]}
              </label>
            </li>
          ))}
        </ul>
        <p className="hint">{form.kind === "dsa_art9" ? W.form.sectionCDsa : W.form.sectionCHint}</p>
        <p className="hint">{W.form.sectionCFix}</p>
      </fieldset>
      {tco ? (
        <label className="choice">
          <input type="checkbox" checked={form.emergency} onChange={(event) => set({ emergency: event.target.checked })} />
          {W.form.emergency}
        </label>
      ) : null}
      {form.kind === "dsa_art9" ? (
        <fieldset>
          <legend>{W.form.withhold}</legend>
          <label className="choice">
            <input type="checkbox" checked={locked || form.withhold} disabled={locked} onChange={(event) => set({ withhold: event.target.checked })} />
            {W.form.withhold}
          </label>
          <p className="hint">{locked ? W.form.withholdLocked : W.form.withholdHint}</p>
        </fieldset>
      ) : null}
      {problem ? (
        <p role="alert" className="error">
          {problem}
        </p>
      ) : null}
      {duplicate !== null ? (
        <p>
          <OrderLink id={duplicate} onOpen={onOpenOrder}>
            {W.form.duplicateLink}
          </OrderLink>
        </p>
      ) : null}
      <button type="submit" disabled={busy} aria-busy={busy}>
        {W.form.button}
      </button>
    </form>
  );
}

/** What the order's screen shows once, after the opening (8.4): that it was opened, and after "I cannot tell" what to do. */
export interface Opened {
  view: OrderView;
  unsure: boolean;
}

/**
 * The form with its messages, its sending and its refusals: the messages nobody handled, then those handled in the last
 * 24 hours; a refusal in the console's words, order_exists with a link to the order that stands. Contact point opens it
 * with a message picked, the Orders screen with nothing picked.
 */
export function OpenOrder({ api, me, message, onOpened, onOpenOrder }: { api: StaffApi; me: StaffMe; message: string | null; onOpened(opened: Opened): void; onOpenOrder(id: OrderId): void }) {
  const [form, setForm] = useState<OrderFormState>(() => emptyOrderForm(message));
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<OrderId | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const page = await api.contact(null, false, { activity: true });
        const since = Date.now() - 24 * 60 * MIN;
        const open = page.items.filter((m) => m.disposition === null);
        const recent = page.items.filter((m) => m.disposition !== null && m.handledAt !== null && Date.parse(m.handledAt) > since);
        if (alive.current) setMessages([...open, ...recent]);
      } catch (err) {
        if (alive.current) setProblem(describeError(err));
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [api]);

  const submit = async () => {
    setDuplicate(null);
    const built = orderRequest(form);
    if (!built.ok) {
      setProblem(built.problem);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const view = await api.openOrder(built.request, { activity: true });
      if (alive.current) onOpened({ view, unsure: form.sectionC === "unsure" });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.code === "rate_limited") setProblem(W.form.limit);
      else setProblem(describeError(err));
      const stands = err instanceof ApiError && err.code === "order_exists" ? (err.details as { orderId?: unknown } | undefined)?.orderId : undefined;
      if (typeof stands === "string") setDuplicate(parseOrderId(stands));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return <OrderForm me={me} form={form} messages={messages} busy={busy} problem={problem} duplicate={duplicate} onChange={setForm} onSubmit={() => void submit()} onOpenOrder={onOpenOrder} />;
}

/** The Orders screen: the list, read again every 20 seconds, and "Open an order" above it. */
export function Orders({ api, me, onOpenOrder, onOpened }: { api: StaffApi; me: StaffMe; onOpenOrder(id: OrderId): void; onOpened(opened: Opened): void }) {
  const [page, setPage] = useState<Loadable<OrdersPage>>({ state: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [forming, setForming] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const read = async (activity: boolean) => {
      try {
        const value = await api.orders({ activity });
        if (alive.current) {
          setPage({ state: "ready", value });
          setNow(Date.now());
        }
      } catch (err) {
        if (alive.current) setPage({ state: "failed", message: describeError(err) });
      }
    };
    void read(true);
    // Read again every 20 seconds without the mark: a page that reads by itself is no person's action.
    const timer = setInterval(() => void read(false), 20_000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [api]);

  return (
    <section aria-labelledby="orders-title">
      <h2 id="orders-title">{W.orders.title}</h2>
      {forming ? (
        <OpenOrder api={api} me={me} message={null} onOpened={onOpened} onOpenOrder={onOpenOrder} />
      ) : (
        <button type="button" onClick={() => setForming(true)}>
          {W.orders.open}
        </button>
      )}
      <Loaded value={page} render={(value) => <OrdersList page={value} now={now} onOpenOrder={onOpenOrder} />} />
    </section>
  );
}
