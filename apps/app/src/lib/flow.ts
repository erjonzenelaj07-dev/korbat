/**
 * State of the sign-in flow between screens. Kept in memory, never in the URL, so email addresses,
 * flow ids and MFA tickets do not end up in browser history. A page reload starts the flow over.
 */
export interface FlowState {
  email?: string;
  flowId?: string;
  mfaTicket?: string;
}

let state: FlowState = {};

export const flow = {
  get(): FlowState {
    return state;
  },
  set(patch: FlowState): void {
    state = { ...state, ...patch };
  },
  clear(): void {
    state = {};
  },
};
