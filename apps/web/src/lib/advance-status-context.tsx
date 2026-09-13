import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// Mirrors import-status-context.tsx: lets AdvanceHome tell AdvanceStatusDrawer "I'm already
// showing this run's live progress inline, don't also show your own corner summary" while the
// review modal is open, the same relationship ImportDataModal has with ImportStatusDrawer.
type AdvanceStatusContextValue = {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
};

const AdvanceStatusContext = createContext<AdvanceStatusContextValue | null>(null);

export function AdvanceStatusProvider({ children }: { children: ReactNode }) {
  const [modalOpen, setModalOpen] = useState(false);
  const value = useMemo(() => ({ modalOpen, setModalOpen }), [modalOpen]);
  return <AdvanceStatusContext.Provider value={value}>{children}</AdvanceStatusContext.Provider>;
}

export function useAdvanceStatus() {
  return useContext(AdvanceStatusContext);
}
