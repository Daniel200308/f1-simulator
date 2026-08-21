"use client";

import { Download, HardDrive, RotateCcw, Save, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "./save-manager.module.css";

interface SaveManagerProps {
  hasAutosave: boolean;
  lastSavedAt: string | null;
  onClose: () => void;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onLoadAutosave: () => void;
  onSave: () => void;
}

export function SaveManager({ hasAutosave, lastSavedAt, onClose, onExport, onImport, onLoadAutosave, onSave }: SaveManagerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section aria-label="Save game" aria-modal="true" className={styles.panel} role="dialog">
      <header><span><HardDrive aria-hidden="true" size={20} /></span><div><small>GAME STATE · SCHEMA V1</small><h2>Save & restore</h2></div><button aria-label="Close save manager" onClick={onClose} ref={closeRef} type="button"><X aria-hidden="true" size={18} /></button></header>
      <p>Race physics, weekend progress, championship standings, reliability and tyre inventory are stored together.</p>
      <div className={styles.status}><i data-ready={hasAutosave} /><span><strong>{hasAutosave ? "AUTOSAVE READY" : "NO AUTOSAVE"}</strong><small>{lastSavedAt ? new Date(lastSavedAt).toLocaleString() : "Save once to create a restore point"}</small></span></div>
      {error && <div aria-live="assertive" className={styles.error}>{error}</div>}
      <div className={styles.actions}>
        <button onClick={onSave} type="button"><Save aria-hidden="true" size={17} /><span><strong>Save now</strong><small>Update local autosave</small></span></button>
        <button disabled={!hasAutosave} onClick={onLoadAutosave} type="button"><RotateCcw aria-hidden="true" size={17} /><span><strong>Restore</strong><small>Load latest local state</small></span></button>
        <button onClick={onExport} type="button"><Download aria-hidden="true" size={17} /><span><strong>Export JSON</strong><small>Portable backup file</small></span></button>
        <button onClick={() => inputRef.current?.click()} type="button"><Upload aria-hidden="true" size={17} /><span><strong>Import JSON</strong><small>Validate before loading</small></span></button>
      </div>
      <input accept="application/json,.json" hidden onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setError(null); await onImport(file); } catch (caught) { setError(caught instanceof Error ? caught.message : "Save file could not be loaded."); } finally { event.target.value = ""; } }} ref={inputRef} type="file" />
    </section>
  </div>;
}
