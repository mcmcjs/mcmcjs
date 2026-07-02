import { createContext, type PropsWithChildren, useContext } from "react";
import type { StanSamplerOptions } from "../sampler";
import { type UseStanWasmSamplerReturn, useStanWasmSampler } from "./useStanWasmSampler";

const StanWasmSamplerContext = createContext<UseStanWasmSamplerReturn | null>(null);

export type StanWasmSamplerProviderProps = PropsWithChildren<StanSamplerOptions>;

export function StanWasmSamplerProvider(props: StanWasmSamplerProviderProps) {
  const { children, ...opts } = props;
  const sampler = useStanWasmSampler(opts);
  return (
    <StanWasmSamplerContext.Provider value={sampler}>{children}</StanWasmSamplerContext.Provider>
  );
}

export function useStanWasmSamplerContext(): UseStanWasmSamplerReturn {
  const value = useContext(StanWasmSamplerContext);
  if (!value) {
    throw new Error("useStanWasmSamplerContext must be called inside a <StanWasmSamplerProvider>");
  }
  return value;
}
