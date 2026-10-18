import {
  ANNEX3_GROUNDS,
  ANNEX3_GROUND_LABELS,
  EU_MEMBER_STATES,
  HOLD_END_REASON_LABELS,
  ORDER_CHANNELS,
  ORDER_CHANNEL_LABELS,
  ORDER_CLOSE_GROUNDS,
  ORDER_CORRECTION_RULE_WORDS,
  ORDER_EVENT_WORDS,
  ORDER_GROUND_LABELS,
  ORDER_ITEM_CLOSE_REASONS,
  ORDER_ITEM_CLOSE_REASON_LABELS,
  ORDER_KINDS,
  ORDER_KIND_LABELS,
  ORDER_RULES,
  SCRUTINY_OUTCOME_LABELS,
  STATE_FACTS,
  type ContactMessage,
  type MemberState,
  type OrderConsoleEvent,
  type OrderCorrectFacts,
  type OrderEffectedParams,
  type OrderEventRecordedParams,
  type OrderItemCloseReason,
  type OrderItemView,
  type OrderView,
  type StaffMe,
} from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { describeError, ORDER_WORDS, RECOVERY_WORDS } from "../messages";
import { CaseLink } from "../nav";
import { parseCaseId, type CaseId, type OrderId } from "../router";
import { correctOrderWithKey, effectOrderWithKey, recordOrderEventWithKey } from "../step-up";
import { bothTimes, Loaded, UserText, type Loadable } from "../ui";
import type { CredentialsLike } from "../webauthn";
import { clockLine, OrderFacts } from "./Orders";

/**
 * An order (3f design, section 8.5), in Task 2's blocks: 1 the clock, refreshed every 20 seconds; 2 the check; 3 the
 * items, with "Close this item without effect" and "Add links"; 5 what was sent and received, each confirmed by the key;
 * 6 the forms' values as text; 7 what the command line owes; 8 the author's notice; 9 the events; 10 "Correct what the
 * order shows". Task 3 adds block 4 ("Disable for an order", the items' ticks and the check from outside), "Extension
 * received" in block 5, an item's preservation, reinstatement and case, and [hold.warn]. The authority, the reference and
 * each link are an outsider's words and drawn as such; no image and no text of a post that is not public is shown.
 */

const W = ORDER_WORDS.order;

/** Block 2: the check, worded by the order's kind, with the home state's register entries. */
export function CheckBlock({ order, me }: { order: OrderView; me: Pick<StaffMe, "homeState"> }) {
  const facts = me.homeState === null ? undefined : STATE_FACTS[me.homeState as MemberState];
  const state = EU_MEMBER_STATES[order.memberState];
  if (order.kind !== "tco_removal") {
    return (
      <section className="block">
        <p>{W.registerDsa}</p>
        {!order.verified ? <p className="notice">{W.verifyFirst}</p> : null}
      </section>
    );
  }
  return (
    <section className="block">
      <p>
        {W.register(state).before}
        <UserText>{order.authority}</UserText>
        {W.register(state).after}
      </p>
      <p className="notice">{W.doubt}</p>
      {facts !== undefined ? (
        <ul className="blocks">
          {facts.authorities.map((authority) => (
            <li key={authority.id}>{W.entry(authority.name, authority.registerEntry ?? W.stateUnknown)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** What an item resolved to and what became of it (block 3). */
function ItemFacts({ item }: { item: OrderItemView }) {
  return (
    <>
      {item.post !== null ? (
        <p>
          {W.resolved(bothTimes(item.post.createdAt), item.post.images).before}
          <UserText>{item.post.authorHandle ?? ""}</UserText>
          {W.resolved(bothTimes(item.post.createdAt), item.post.images).after}
        </p>
      ) : null}
      {item.post !== null && item.post.preview !== null ? (
        <figure className="frame">
          <p>
            <UserText>{item.post.preview}</UserText>
          </p>
        </figure>
      ) : null}
      {item.linkKind === "image" ? <p className="hint">{W.image}</p> : null}
      {item.linkKind === "account" ? <p className="notice">{W.account}</p> : null}
      {item.linkKind === "other" ? <p className="notice">{W.missing}</p> : null}
      {item.post?.deletedOn ? <p>{W.deleted(item.post.deletedOn)}</p> : null}
      <p>
        {item.closedAt !== null && item.closedReason !== null
          ? W.closedItem(bothTimes(item.closedAt), ORDER_ITEM_CLOSE_REASON_LABELS[item.closedReason])
          : item.disabledAt !== null
            ? W.disabledAt(bothTimes(item.disabledAt))
            : W.notDisabled}
      </p>
      {item.inForce && item.noEffect !== null ? <p className="hint">{item.noEffect === "already" ? W.alreadyNow : W.deletedNow}</p> : null}
      {item.inForce && item.preserveUntil !== null && item.preserveEndedAt === null ? <p>{W.preservedUntil(bothTimes(item.preserveUntil))}</p> : null}
      {/* Task 4: the preservation's end erased the post's content; its UTC day, which the notice names too. */}
      {item.erasedAt !== null ? <p>{W.erased(item.erasedAt.slice(0, 10))}</p> : null}
      {item.reinstatedAt !== null && !item.inForce ? (
        <p>{W.reinstatedAt(bothTimes(item.reinstatedAt), item.reinstatedGround === null ? "" : (GROUND_WORDS[item.reinstatedGround] ?? item.reinstatedGround))}</p>
      ) : null}
    </>
  );
}

/** Task 3: the items "Disable for an order" can take now, in their order: a post, not in force, not closed, on an open order. */
export function effectable(order: OrderView): OrderItemView[] {
  if (order.closedAt !== null || order.kind === "dsa_art10") return [];
  return order.items.filter((item) => item.postId !== null && !item.inForce && item.closedAt === null);
}

/** Whether an item is ticked: as the person set it, or by default the first itemsPerAction of those that can be disabled. */
export function isTicked(order: OrderView, ticks: Readonly<Record<string, boolean>>, itemId: string): boolean {
  const index = effectable(order).findIndex((item) => item.id === itemId);
  if (index < 0) return false;
  return ticks[itemId] ?? index < ORDER_RULES.itemsPerAction;
}

/**
 * The params of order_effected (10.3) from the order as shown and the ticked items: each item's id and post, sorted by
 * post, the order's facts as the page read them, and `urgent` as ticked.
 */
export function effectParamsOf(order: OrderView, itemIds: readonly string[], urgent: boolean): OrderEffectedParams {
  const items = order.items
    .filter((item) => itemIds.includes(item.id) && item.postId !== null)
    .map((item) => ({ itemId: item.id, postId: item.postId as string }))
    .sort((a, b) => (a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0));
  return {
    kind: order.kind === "dsa_art9" ? "dsa_art9" : "tco_removal",
    memberState: order.memberState,
    authority: order.authority,
    reference: order.reference,
    sectionC: order.sectionC,
    emergency: order.emergency,
    withholdFromAuthor: order.withholdFromAuthor,
    urgent,
    items,
  };
}

/** One item's block, with its closing while it is open. */
function ItemBlock({
  item,
  order,
  reason,
  busy,
  ticked,
  onReason,
  onClose,
  onTick,
  onOpenCase,
}: {
  item: OrderItemView;
  order: OrderView;
  reason: OrderItemCloseReason | null;
  busy: boolean;
  ticked: boolean;
  onReason(reason: OrderItemCloseReason): void;
  onClose(): void;
  onTick(ticked: boolean): void;
  onOpenCase?: (id: CaseId) => void;
}) {
  const open = item.disabledAt === null && item.closedAt === null;
  const caseId = item.disabledAt !== null && item.caseId !== null ? parseCaseId(item.caseId) : null;
  const canTick = effectable(order).some((candidate) => candidate.id === item.id);
  return (
    <li className="block">
      <p>{W.item(item.position)}</p>
      <figure className="frame">
        <figcaption>{ORDER_WORDS.orders.frame}</figcaption>
        <p>
          <UserText>{item.link}</UserText>
        </p>
      </figure>
      <ItemFacts item={item} />
      {caseId !== null && onOpenCase !== undefined ? (
        <p>
          <CaseLink id={caseId} onOpen={onOpenCase}>
            Open the case
          </CaseLink>
        </p>
      ) : null}
      {canTick ? (
        <label className="choice">
          <input type="checkbox" checked={ticked} disabled={busy} onChange={(event) => onTick(event.target.checked)} />
          {W.effectTick}
        </label>
      ) : null}
      {item.unverified && order.verified ? <p className="notice">{W.unchecked(bothTimes(item.addedAt))}</p> : null}
      {open && order.mayCorrect !== null ? (
        <fieldset>
          <legend>{W.closeItem}</legend>
          <ul className="choices">
            {ORDER_ITEM_CLOSE_REASONS.map((value) => (
              <li key={value}>
                <label className="choice">
                  <input type="radio" name={`close-${item.id}`} checked={reason === value} disabled={busy} onChange={() => onReason(value)} />
                  {ORDER_ITEM_CLOSE_REASON_LABELS[value]}
                </label>
              </li>
            ))}
          </ul>
          {reason === "withdrawn" ? <p className="hint">{W.withdrawnHint}</p> : null}
          <p className="hint">{W.closeItemHint}</p>
          <button type="button" disabled={busy || reason === null} onClick={onClose}>
            {W.closeItem}
          </button>
        </fieldset>
      ) : null}
    </li>
  );
}

/** The words of each console event the screen offers (block 5), with what it records. */
const EVENT_WORDS: Record<OrderConsoleEvent, { button: string; what: (order: OrderView) => string }> = {
  annex3_sent: { button: W.annex3, what: () => W.annex3What },
  grounds_ceased: { button: W.ceased, what: () => W.ceasedWhat },
  clarification_received: { button: W.clarified, what: () => W.clarifiedWhat },
  annex2_sent: { button: W.annex2, what: () => W.annex2What },
  receipt_confirmed: { button: W.informed, what: () => W.informedWhat },
  closed_without_effect: { button: W.close, what: () => W.closeWhat },
  reopened: { button: W.reopen, what: () => W.reopenWhat },
  // Task 3: an admin records a removal order's one extension; the database says when it would otherwise release.
  hold_extended: { button: W.extended, what: (order) => W.extendedWhat(order.hold?.until ? bothTimes(order.hold.until) : "") },
};

/** Block 5: each event the database would take now, with its choice of ground or message, confirmed by the key. */
export function EventsBlock({
  order,
  messages,
  busy,
  onRecord,
}: {
  order: OrderView;
  messages: ContactMessage[];
  busy: boolean;
  onRecord(params: OrderEventRecordedParams): void;
}) {
  const [ground, setGround] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const offered = order.mayEvents;
  if (offered.length === 0) return null;
  return (
    <section className="block">
      <h3>{W.eventsTitle}</h3>
      {offered.map((kind) => {
        const grounds: readonly string[] | null = kind === "annex3_sent" ? ANNEX3_GROUNDS : kind === "closed_without_effect" ? ORDER_CLOSE_GROUNDS : null;
        const needsMessage = kind === "clarification_received" || kind === "hold_extended";
        const chosen = grounds === null ? null : (ground[kind] ?? null);
        const message = picked[kind] ?? null;
        const ready = (grounds === null || chosen !== null) && (!needsMessage || message !== null);
        return (
          <fieldset key={kind}>
            <legend>{EVENT_WORDS[kind].button}</legend>
            <p className="hint">{EVENT_WORDS[kind].what(order)}</p>
            {grounds !== null ? (
              <ul className="choices">
                {grounds.map((value) => (
                  <li key={value}>
                    <label className="choice">
                      <input type="radio" name={`ground-${kind}`} checked={chosen === value} disabled={busy} onChange={() => setGround((g) => ({ ...g, [kind]: value }))} />
                      {kind === "annex3_sent" ? ANNEX3_GROUND_LABELS[value as (typeof ANNEX3_GROUNDS)[number]] : ORDER_GROUND_LABELS[value as (typeof ORDER_CLOSE_GROUNDS)[number]]}
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {needsMessage ? (
              <ul className="choices">
                {messages.map((m) => (
                  <li key={m.id}>
                    <label className="choice">
                      <input type="radio" name={`message-${kind}`} checked={message === m.id} disabled={busy} onChange={() => setPicked((p) => ({ ...p, [kind]: m.id }))} />
                      {`${ORDER_WORDS.contact.received(bothTimes(m.receivedAt))}, ${ORDER_WORDS.contact.folders[m.folder]}`}
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" disabled={busy || !ready} onClick={() => onRecord({ kind, ground: chosen as OrderEventRecordedParams["ground"], messageId: needsMessage ? message : null })}>
              {`${EVENT_WORDS[kind].button}: ${W.confirmKey}`}
            </button>
          </fieldset>
        );
      })}
    </section>
  );
}

/** A time as the forms ask for it: in UTC with its offset written out ("2026-10-10 01:00:12 +00:00"). */
export function utcWithOffset(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} +00:00`;
}

/** Block 6: the forms' values as text, for a removal order. */
export function FormsBlock({ order, me }: { order: OrderView; me: Pick<StaffMe, "homeState" | "contactPoint"> }) {
  if (order.kind !== "tco_removal") return null;
  const copy = me.homeState === null ? null : (STATE_FACTS[me.homeState as MemberState]?.annexCopy ?? null);
  const ground = order.clock?.stopGround ?? null;
  const state = `${EU_MEMBER_STATES[order.memberState]} (${order.memberState})`;
  const lines = W.annex3Text(order.reference, order.authority, state, order.receivedAt === null ? "" : utcWithOffset(order.receivedAt), ground === null ? "" : ANNEX3_GROUND_LABELS[ground]);
  return (
    <section className="block">
      <h3>{W.formsTitle}</h3>
      <pre className="form-values">
        <UserText>{[...lines, W.contactLine(me.contactPoint ?? W.stateUnknown), W.sendTo(copy ?? W.stateUnknown)].join(String.fromCharCode(10))}</UserText>
      </pre>
    </section>
  );
}

/** Block 7: what the command line still owes, one line each. */
export function OwedBlock({ order }: { order: OrderView }) {
  const lines: string[] = [];
  const added = order.items.filter((item) => item.unverified).length;
  if (order.owed.verification) lines.push(order.verified && added > 0 ? W.owesVerifyAgain(added) : W.owesVerify);
  if (order.owed.issuedAt) lines.push(W.owesIssued);
  if (order.owed.holdUntil) lines.push(W.owesHoldUntil);
  if (order.owed.texts) lines.push(order.kind === "dsa_art9" && !order.items.some((i) => i.disabledAt !== null) ? W.owesTextsDsa : W.owesTexts);
  if (order.owed.tellPerson) lines.push(W.owesTellRule);
  if (order.owed.document) lines.push(W.owesDocument);
  if (order.owed.scrutinyUntil !== null) lines.push(ORDER_WORDS.orders.scrutinyUntil(bothTimes(order.owed.scrutinyUntil)));
  if (lines.length === 0) return null;
  return (
    <section className="block">
      <h3>{W.owesTitle}</h3>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </section>
  );
}

/** Block 8: the author's notice: told, or held until when and on which rule, and released or ended. */
export function NoticeBlock({ order, now = Date.now() }: { order: OrderView; now?: number }) {
  const hold = order.hold;
  const lines: string[] = [];
  if (hold === null) {
    for (const item of order.items) if (item.disabledAt !== null) lines.push(W.toldAt(bothTimes(item.disabledAt)));
  } else if (hold.open) lines.push(W.holdOpen);
  else if (hold.until !== null) lines.push(hold.basis === "regulation" ? W.holdUntil(bothTimes(hold.until), order.issuedAt === null ? "receipt" : "order", hold.extended) : W.holdAuthority(bothTimes(hold.until)));
  if (hold?.releasedAt) lines.push(W.released(bothTimes(hold.releasedAt)));
  if (hold?.endedAt && hold.endReason) lines.push(W.ended(bothTimes(hold.endedAt), HOLD_END_REASON_LABELS[hold.endReason]));
  // [hold.warn] (Task 3): in the last holdWarningDays before a running hold's end.
  if (hold !== null && hold.until !== null && hold.releasedAt === null && hold.endedAt === null) {
    const left = Date.parse(hold.until) - now;
    if (left > 0 && left <= ORDER_RULES.holdWarningDays * 86_400_000) lines.push(W.holdWarn(bothTimes(hold.until)));
  }
  if (lines.length === 0) return null;
  return (
    <section className="block">
      <h3>{W.noticeTitle}</h3>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </section>
  );
}

/** Every ground's words, for an event's phrase. */
const GROUND_WORDS: Record<string, string> = { ...ANNEX3_GROUND_LABELS, ...ORDER_GROUND_LABELS, ...HOLD_END_REASON_LABELS, ...SCRUTINY_OUTCOME_LABELS, ...ORDER_CORRECTION_RULE_WORDS };

/** One event's words (W.1), filled from the event. */
export function eventWords(order: OrderView, event: OrderView["events"][number]): string {
  const position = order.items.find((item) => item.id === event.itemId)?.position ?? 0;
  const ground = event.ground === null ? "" : (GROUND_WORDS[event.ground] ?? event.ground);
  const at = bothTimes(event.effectiveAt ?? event.at);
  return ORDER_EVENT_WORDS[event.kind]
    .replace("{ground}", ground)
    .replace("{reason}", ground)
    .replace("{rule}", ground)
    .replace("{outcome}", ground)
    .replace("{effectiveAt}", at)
    .replace("{n}", String(position))
    .replace("{until}", "");
}

/** Block 9: the events, newest first, each with who wrote it. */
export function EventsList({ order }: { order: OrderView }) {
  return (
    <section className="block">
      <h3>{W.eventsList}</h3>
      <ul className="blocks">
        {[...order.events].reverse().map((event) => (
          <li key={event.id}>
            <p>{`${bothTimes(event.at)}: ${eventWords(order, event)}`}</p>
            <p className="hint">
              {event.via === "console" && event.by !== null ? (
                <>
                  @<UserText>{event.by}</UserText>, console
                </>
              ) : event.via === "cli" ? (
                W.byCli
              ) : (
                W.bySystem
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What block 10 holds while it is filled in: every member the form took, as the order shows it now. */
interface CorrectionState {
  kind: OrderView["kind"];
  memberState: MemberState;
  authority: string;
  reference: string;
  channel: OrderView["channel"];
  sectionC: boolean;
  emergency: boolean;
  withholdFromAuthor: boolean;
}

const correctionOf = (order: OrderView): CorrectionState => ({
  kind: order.kind,
  memberState: order.memberState,
  authority: order.authority,
  reference: order.reference,
  channel: order.channel,
  sectionC: order.sectionC,
  emergency: order.emergency,
  withholdFromAuthor: order.withholdFromAuthor,
});

/** The members that changed, and only those: the correction sends what changes and nothing else. */
export function changedFacts(order: OrderView, state: CorrectionState): OrderCorrectFacts {
  const facts: Record<string, unknown> = {};
  const before = correctionOf(order);
  for (const key of Object.keys(state) as (keyof CorrectionState)[]) if (state[key] !== before[key]) facts[key] = state[key];
  // A channel is the console's only for an order opened without a message.
  if (order.messageId !== null) delete facts.channel;
  return facts as OrderCorrectFacts;
}

/**
 * Block 10, "Correct what the order shows": the controls the rule allows (mayCorrect). Under caution only "the author must
 * not be told" from no to yes; under entry and admin every member, an admin's with the key.
 */
export function CorrectBlock({ order, busy, onCorrect }: { order: OrderView; busy: boolean; onCorrect(facts: OrderCorrectFacts): void }) {
  const [state, setState] = useState<CorrectionState>(() => correctionOf(order));
  useEffect(() => setState(correctionOf(order)), [order]);
  if (order.mayCorrect === null) return null;
  const set = (patch: Partial<CorrectionState>) => setState((current) => ({ ...current, ...patch }));
  const facts = changedFacts(order, state);
  if (order.mayCorrect === "caution") {
    if (order.sectionC) return null;
    return (
      <section className="block">
        <h3>{W.correctTitle}</h3>
        <p className="hint">{W.correctSilence}</p>
        <button type="button" disabled={busy} onClick={() => onCorrect({ sectionC: true })}>
          {ORDER_WORDS.form.sectionCChoices.tco[0]}
        </button>
      </section>
    );
  }
  return (
    <section className="block">
      <h3>{W.correctTitle}</h3>
      <p className="hint">{W.correctWhat}</p>
      <label className="field">
        {ORDER_WORDS.form.kind}
        <select value={state.kind} disabled={busy} onChange={(event) => set({ kind: event.target.value as CorrectionState["kind"] })}>
          {ORDER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {ORDER_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {ORDER_WORDS.form.state}
        <select value={state.memberState} disabled={busy} onChange={(event) => set({ memberState: event.target.value as MemberState })}>
          {(Object.keys(EU_MEMBER_STATES) as MemberState[]).map((code) => (
            <option key={code} value={code}>
              {`${EU_MEMBER_STATES[code]} (${code})`}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {ORDER_WORDS.form.authority}
        <input type="text" value={state.authority} maxLength={400} disabled={busy} onChange={(event) => set({ authority: event.target.value })} />
      </label>
      <label className="field">
        {ORDER_WORDS.form.reference}
        <input type="text" value={state.reference} maxLength={400} disabled={busy} onChange={(event) => set({ reference: event.target.value })} />
      </label>
      {order.messageId === null ? (
        <label className="field">
          {ORDER_WORDS.form.channel}
          <select value={state.channel} disabled={busy} onChange={(event) => set({ channel: event.target.value as CorrectionState["channel"] })}>
            {ORDER_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {ORDER_CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="choice">
        <input type="checkbox" checked={state.sectionC} disabled={busy} onChange={(event) => set({ sectionC: event.target.checked, withholdFromAuthor: event.target.checked || state.withholdFromAuthor })} />
        {ORDER_WORDS.form.sectionCChoices.tco[0]}
      </label>
      {state.sectionC && !order.sectionC ? <p className="hint">{W.correctSilence}</p> : null}
      {!state.sectionC && order.sectionC ? <p className="hint">{W.correctUnsilence}</p> : null}
      <label className="choice">
        <input type="checkbox" checked={state.emergency} disabled={busy} onChange={(event) => set({ emergency: event.target.checked })} />
        {ORDER_WORDS.form.emergency}
      </label>
      {state.kind === "dsa_art9" ? (
        <label className="choice">
          <input type="checkbox" checked={state.withholdFromAuthor || state.sectionC} disabled={busy || state.sectionC} onChange={(event) => set({ withholdFromAuthor: event.target.checked })} />
          {ORDER_WORDS.form.withhold}
        </label>
      ) : null}
      <button type="button" disabled={busy || Object.keys(facts).length === 0} onClick={() => onCorrect(facts)}>
        {order.mayCorrect === "admin" ? `${W.correctButton}: ${W.confirmKey}` : W.correctButton}
      </button>
    </section>
  );
}

/** What the screen keeps of its last effect, for [orders.checkOutside]: the effect's time and each address it disabled. */
export interface Effected {
  at: string;
  links: string[];
}

/**
 * Block 4, "Disable for an order" (Task 3): the lines the order's kind and silence call for, the urgent tick for an admin
 * on a DSA order that is not verified, and one button for all ticked items, confirmed by one key. After an effect, the
 * check from outside with each address as text, and [effect.rest] while items are still open.
 */
export function EffectBlock({
  order,
  role,
  ticks,
  urgent,
  busy,
  effected,
  onUrgent,
  onEffect,
}: {
  order: OrderView;
  role: StaffMe["role"];
  ticks: Readonly<Record<string, boolean>>;
  urgent: boolean;
  busy: boolean;
  effected: Effected | null;
  onUrgent(urgent: boolean): void;
  onEffect(params: OrderEffectedParams): void;
}) {
  const candidates = effectable(order);
  const open = order.clock?.itemsOpen ?? order.items.filter((item) => item.closedAt === null && item.disabledAt === null).length;
  const deadline = order.clock?.deadlineAt ?? order.dueAt;
  const after =
    effected === null ? null : (
      <section className="block">
        <p className="notice">{W.checkOutside(bothTimes(effected.at), effected.links.length)}</p>
        <ul className="blocks">
          {effected.links.map((link) => (
            <li key={link}>
              <UserText>{link}</UserText>
            </li>
          ))}
        </ul>
        {open > 0 ? <p className="notice">{W.effectRest(open, deadline === null ? null : bothTimes(deadline))}</p> : null}
      </section>
    );
  if (candidates.length === 0) return after;
  const tco = order.kind === "tco_removal";
  const withholds = tco || order.withholdFromAuthor;
  const told = tco ? !order.sectionC : !order.withholdFromAuthor;
  const until = order.hold?.until ?? null;
  const lines: string[] = [withholds ? W.effectWhat : W.effectRemoved];
  if (tco) {
    // Task 6 (8.5, 8.8): an item whose disabling a restore lost and whose preservation never ended keeps its end; the
    // others count six months from now.
    const again = candidates.filter((item) => item.gap && item.preserveUntil !== null && item.preserveEndedAt === null);
    if (again.length < candidates.length) lines.push(W.effectPreserve);
    for (const end of [...new Set(again.map((item) => item.preserveUntil!))]) lines.push(RECOVERY_WORDS.effectPreserveAgain(bothTimes(end)));
  }
  if (told) lines.push(W.effectTold);
  else if (tco) lines.push(until === null ? W.effectHeldNoReceipt : W.effectHeld(bothTimes(until)));
  else lines.push(until === null || order.hold?.open ? W.effectHeldOpen : W.effectHeldDsa(bothTimes(until)));
  const unverifiedDsa = order.kind === "dsa_art9" && !order.verified;
  const chosen = candidates.filter((item) => isTicked(order, ticks, item.id)).map((item) => item.id);
  const allowed = !unverifiedDsa || (role === "admin" && urgent);
  return (
    <>
      {after}
      <section className="block">
        <h3>{W.effectTitle}</h3>
        {lines.map((line) => (
          <p key={line} className="hint">
            {line}
          </p>
        ))}
        {unverifiedDsa && role === "admin" ? (
          <>
            <label className="choice">
              <input type="checkbox" checked={urgent} disabled={busy} onChange={(event) => onUrgent(event.target.checked)} />
              {W.effectUrgent}
            </label>
            <p className="hint">{W.effectUrgentWhat}</p>
          </>
        ) : null}
        {unverifiedDsa && role !== "admin" ? <p className="notice">{W.verifyFirst}</p> : null}
        <p className="hint">{W.effectAnyone}</p>
        {candidates.length > ORDER_RULES.itemsPerAction ? <p className="notice">{W.effectMax}</p> : null}
        {unverifiedDsa && role !== "admin" ? null : (
          <button
            type="button"
            disabled={busy || !allowed || chosen.length === 0 || chosen.length > ORDER_RULES.itemsPerAction}
            onClick={() => onEffect(effectParamsOf(order, chosen, unverifiedDsa && urgent))}
          >
            {W.effectButton(chosen.length)}
          </button>
        )}
      </section>
    </>
  );
}

export interface OrderPageProps {
  order: OrderView;
  me: Pick<StaffMe, "homeState" | "contactPoint" | "role">;
  now: number;
  messages: ContactMessage[];
  busy: boolean;
  notice: string | null;
  error: string | null;
  /** The reason chosen to close each open item. */
  reasons: Readonly<Record<string, OrderItemCloseReason>>;
  links: string;
  onReason(itemId: string, reason: OrderItemCloseReason): void;
  onCloseItem(itemId: string): void;
  onLinks(text: string): void;
  onAddLinks(): void;
  onRecord(params: OrderEventRecordedParams): void;
  onCorrect(facts: OrderCorrectFacts): void;
  /** Task 3: each item's tick as the person set it, the urgent tick, the last effect, and their handlers. */
  ticks?: Readonly<Record<string, boolean>>;
  urgent?: boolean;
  effected?: Effected | null;
  onTick?: (itemId: string, ticked: boolean) => void;
  onUrgent?: (urgent: boolean) => void;
  onEffect?: (params: OrderEffectedParams) => void;
  onOpenCase?: (id: CaseId) => void;
}

const nothing = () => undefined;

/** The order's page, blocks in order; at 360 px the first screenful holds the clock. */
export function OrderPage(props: OrderPageProps) {
  const { order, me, now, messages, busy, notice, error, reasons, links } = props;
  const ticks = props.ticks ?? {};
  return (
    <section aria-labelledby="order-title">
      <h2 id="order-title">{ORDER_KIND_LABELS[order.kind]}</h2>
      <p className={order.state === "overdue" || order.state === "unknown_deadline" ? "error" : "notice"}>{clockLine({ ...order, items: order.items.length }, now)}</p>
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <OrderFacts order={order} />
      <CheckBlock order={order} me={me} />
      <section className="block">
        <h3>{W.itemsTitle}</h3>
        <ul className="blocks items">
          {order.items.map((item) => (
            <ItemBlock
              key={item.id}
              item={item}
              order={order}
              reason={reasons[item.id] ?? null}
              busy={busy}
              ticked={isTicked(order, ticks, item.id)}
              onReason={(reason) => props.onReason(item.id, reason)}
              onClose={() => props.onCloseItem(item.id)}
              onTick={(ticked) => (props.onTick ?? nothing)(item.id, ticked)}
              {...(props.onOpenCase === undefined ? {} : { onOpenCase: props.onOpenCase })}
            />
          ))}
        </ul>
        {order.closedAt === null && order.kind !== "dsa_art10" ? (
          <label className="field">
            {W.addLinks}
            <textarea value={links} rows={3} disabled={busy} onChange={(event) => props.onLinks(event.target.value)} />
            <span className="hint">{W.added}</span>
            <button type="button" disabled={busy || links.trim() === ""} onClick={props.onAddLinks}>
              {W.addLinks}
            </button>
          </label>
        ) : null}
      </section>
      <EffectBlock
        order={order}
        role={me.role}
        ticks={ticks}
        urgent={props.urgent ?? false}
        busy={busy}
        effected={props.effected ?? null}
        onUrgent={props.onUrgent ?? nothing}
        onEffect={props.onEffect ?? nothing}
      />
      <EventsBlock order={order} messages={messages} busy={busy} onRecord={props.onRecord} />
      <FormsBlock order={order} me={me} />
      <OwedBlock order={order} />
      <NoticeBlock order={order} now={now} />
      <EventsList order={order} />
      <CorrectBlock order={order} busy={busy} onCorrect={props.onCorrect} />
    </section>
  );
}

/**
 * The order's screen: read on opening and every 20 seconds without the mark; each action reads it again from its answer.
 * An event is confirmed by the key; a correction too under the rule admin, and without one under entry and caution.
 */
export function Order({
  id,
  api,
  me,
  credentials,
  opened,
  onOpenCase,
}: {
  id: OrderId;
  api: StaffApi;
  me: StaffMe;
  credentials: CredentialsLike;
  opened: { unsure: boolean } | null;
  onOpenCase?: (id: CaseId) => void;
}) {
  const [order, setOrder] = useState<Loadable<OrderView>>({ state: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(opened === null ? null : opened.unsure ? `${ORDER_WORDS.form.done} ${ORDER_WORDS.form.unsure}` : ORDER_WORDS.form.done);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, OrderItemCloseReason>>({});
  const [links, setLinks] = useState("");
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [urgent, setUrgent] = useState(false);
  const [effected, setEffected] = useState<Effected | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const read = async (activity: boolean) => {
      try {
        const value = await api.order(id, { activity });
        if (alive.current) {
          setOrder({ state: "ready", value });
          setNow(Date.now());
        }
      } catch (err) {
        if (alive.current) setOrder({ state: "failed", message: describeError(err) });
      }
    };
    void read(true);
    void api.contact(null, false, { activity: true }).then(
      (page) => alive.current && setMessages(page.items),
      () => undefined,
    );
    const timer = setInterval(() => void read(false), 20_000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [api, id]);

  /** Runs an action, then shows the order as its answer stands. */
  const act = async (run: () => Promise<OrderView>, done: string | null) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const value = await run();
      if (alive.current) {
        setOrder({ state: "ready", value });
        setNow(Date.now());
        if (done !== null) setNotice(done);
      }
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const deps = { api, credentials };
  const correct = (value: OrderView, facts: OrderCorrectFacts) =>
    act(() => (value.mayCorrect === "admin" ? correctOrderWithKey(deps, id, facts) : api.correctOrder(id, { facts }, { activity: true })), W.corrected);
  /** Block 4: one key for the ticked items; the answer's newest effect_given is the time the check from outside names. */
  const effect = (params: OrderEffectedParams) =>
    act(async () => {
      const value = await effectOrderWithKey(deps, id, params);
      const at = [...value.events].reverse().find((event) => event.kind === "effect_given")?.at ?? new Date().toISOString();
      const done = new Set(params.items.map((item) => item.itemId));
      if (alive.current) {
        setEffected({ at, links: value.items.filter((item) => done.has(item.id)).map((item) => item.link) });
        setTicks({});
        setUrgent(false);
      }
      return value;
    }, null);

  return (
    <Loaded
      value={order}
      render={(value) => (
        <OrderPage
          order={value}
          me={me}
          now={now}
          messages={messages}
          busy={busy}
          notice={notice}
          error={error}
          reasons={reasons}
          links={links}
          onReason={(itemId, reason) => setReasons((current) => ({ ...current, [itemId]: reason }))}
          onCloseItem={(itemId) => {
            const reason = reasons[itemId];
            if (reason !== undefined) void correct(value, { closeItems: [{ itemId, reason }] });
          }}
          onLinks={setLinks}
          onAddLinks={() => {
            const list = links.split(String.fromCharCode(10)).map((line) => line.trim()).filter((line) => line !== "");
            void act(() => api.addOrderItems(id, { links: list }, { activity: true }), null).then(() => setLinks(""));
          }}
          onRecord={(params) => void act(() => recordOrderEventWithKey(deps, id, params), null)}
          onCorrect={(facts) => void correct(value, facts)}
          ticks={ticks}
          urgent={urgent}
          effected={effected}
          onTick={(itemId, ticked) => setTicks((current) => ({ ...current, [itemId]: ticked }))}
          onUrgent={setUrgent}
          onEffect={(params) => void effect(params)}
          {...(onOpenCase === undefined ? {} : { onOpenCase })}
        />
      )}
    />
  );
}
