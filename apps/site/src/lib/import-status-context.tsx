import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type ImportStatusContextValue = {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
};

const ImportStatusContext = createContext<ImportStatusContextValue | null>(null);

export function ImportStatusProvider({ children }: { children: ReactNode }) {
  const [modalOpen, setModalOpen] = useState(false);
  const value = useMemo(() => ({ modalOpen, setModalOpen }), [modalOpen]);
  return <ImportStatusContext.Provider value={value}>{children}</ImportStatusContext.Provider>;
}

export function useImportStatus() {
  return useContext(ImportStatusContext);
}
