import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ChatChannelType } from "@rec/shared";

type ChatDrawerTarget = { channelType: ChatChannelType; channelId: string } | null;

type ChatDrawerContextValue = {
  open: boolean;
  target: ChatDrawerTarget;
  /** Opens the drawer, optionally jumping straight to a given channel (e.g. a "3 unread in
   * game chat" card elsewhere in the app). Omit the target to just open on whatever channel
   * was last selected. */
  openTo: (target?: { channelType: ChatChannelType; channelId: string }) => void;
  close: () => void;
};

const ChatDrawerContext = createContext<ChatDrawerContextValue | null>(null);

export function ChatDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ChatDrawerTarget>(null);

  const openTo = useCallback((next?: { channelType: ChatChannelType; channelId: string }) => {
    setTarget(next ?? null);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo<ChatDrawerContextValue>(() => ({ open, target, openTo, close }), [open, target, openTo, close]);
  return <ChatDrawerContext.Provider value={value}>{children}</ChatDrawerContext.Provider>;
}

export function useChatDrawer() {
  const context = useContext(ChatDrawerContext);
  if (!context) throw new Error("useChatDrawer must be used within ChatDrawerProvider");
  return context;
}
