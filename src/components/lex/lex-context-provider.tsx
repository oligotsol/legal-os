"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { LexPageKind } from "@/lib/ai/lex-context";

interface LexPageState {
  kind: LexPageKind;
  recordId: string | null;
}

interface Ctx {
  state: LexPageState;
  setState: (s: LexPageState) => void;
}

const LexContext = createContext<Ctx | null>(null);

export function LexContextProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LexPageState>({
    kind: "unknown",
    recordId: null,
  });
  return (
    <LexContext.Provider value={{ state, setState }}>
      {children}
    </LexContext.Provider>
  );
}

export function useLexContext(): LexPageState {
  const ctx = useContext(LexContext);
  return ctx ? ctx.state : { kind: "unknown", recordId: null };
}

/**
 * Pages call this with their kind + record id so Lex knows what's on screen.
 * The widget reads this context and forwards `page` + `recordId` to the proxy,
 * which server-fetches the record (we never trust the client to ship record
 * bodies into the prompt).
 */
export function useRegisterLexContext(kind: LexPageKind, recordId: string | null) {
  const ctx = useContext(LexContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setState({ kind, recordId });
    return () => {
      ctx.setState({ kind: "unknown", recordId: null });
    };
  }, [ctx, kind, recordId]);
}
