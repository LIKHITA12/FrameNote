"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ProcessingContextValue = {
  activeJobId: string | null;
  /** True while the file uploads / the job is being created and no job id exists yet. */
  preparing: boolean;
  preparingLabel: string | null;
  /** 0-100 upload progress, or null while indeterminate (job creation, not a file upload). */
  uploadProgress: number | null;
  minimized: boolean;
  /** Show the modal immediately, before the job id is known. */
  beginProcessing: (label?: string) => void;
  setUploadProgress: (percent: number | null) => void;
  startProcessing: (jobId: string) => void;
  failPreparing: () => void;
  minimize: () => void;
  restore: () => void;
  dismiss: () => void;
};

const ProcessingContext = createContext<ProcessingContextValue | null>(null);

export function ProcessingProvider({ children }: { children: ReactNode }) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [preparingLabel, setPreparingLabel] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [minimized, setMinimized] = useState(false);

  const beginProcessing = useCallback((label?: string) => {
    setActiveJobId(null);
    setPreparing(true);
    setPreparingLabel(label ?? null);
    setUploadProgress(null);
    setMinimized(false);
  }, []);

  const startProcessing = useCallback((jobId: string) => {
    setActiveJobId(jobId);
    setPreparing(false);
    setUploadProgress(null);
    setMinimized(false);
  }, []);

  const failPreparing = useCallback(() => {
    setPreparing(false);
    setPreparingLabel(null);
    setUploadProgress(null);
    setActiveJobId(null);
  }, []);

  const minimize = useCallback(() => setMinimized(true), []);
  const restore = useCallback(() => setMinimized(false), []);
  const dismiss = useCallback(() => {
    setActiveJobId(null);
    setPreparing(false);
    setPreparingLabel(null);
    setUploadProgress(null);
    setMinimized(false);
  }, []);

  const value = useMemo(
    () => ({
      activeJobId,
      preparing,
      preparingLabel,
      uploadProgress,
      minimized,
      beginProcessing,
      setUploadProgress,
      startProcessing,
      failPreparing,
      minimize,
      restore,
      dismiss,
    }),
    [
      activeJobId,
      preparing,
      preparingLabel,
      uploadProgress,
      minimized,
      beginProcessing,
      startProcessing,
      failPreparing,
      minimize,
      restore,
      dismiss,
    ]
  );

  return <ProcessingContext.Provider value={value}>{children}</ProcessingContext.Provider>;
}

export function useProcessing(): ProcessingContextValue {
  const ctx = useContext(ProcessingContext);
  if (!ctx) throw new Error("useProcessing must be used within a ProcessingProvider");
  return ctx;
}
