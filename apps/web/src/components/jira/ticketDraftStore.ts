import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { TicketDraft } from "./ticketDraft.logic";

interface TicketDraftState {
  /** Keyed by the draft's future thread id, which survives a reload with the draft. */
  readonly drafts: Readonly<Record<string, TicketDraft>>;
  readonly setDraft: (threadId: ThreadId, draft: TicketDraft) => void;
  readonly clearDraft: (threadId: ThreadId) => void;
}

export const useTicketDraftStore = create<TicketDraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (threadId, draft) =>
        set((state) => ({ drafts: { ...state.drafts, [threadId]: draft } })),
      clearDraft: (threadId) =>
        set((state) => {
          if (!(threadId in state.drafts)) return state;
          const { [threadId]: _removed, ...drafts } = state.drafts;
          return { drafts };
        }),
    }),
    {
      name: "t3code:ticket-drafts:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ drafts: state.drafts }),
    },
  ),
);

export function readTicketDraft(threadId: ThreadId): TicketDraft | null {
  return useTicketDraftStore.getState().drafts[threadId] ?? null;
}

export function clearTicketDraft(threadId: ThreadId): void {
  useTicketDraftStore.getState().clearDraft(threadId);
}

export function useTicketDraft(threadId: ThreadId): TicketDraft | null {
  return useTicketDraftStore((state) => state.drafts[threadId] ?? null);
}
