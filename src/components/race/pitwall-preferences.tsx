"use client";

import { Contrast, Gauge, HelpCircle, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef } from "react";

import styles from "./pitwall-preferences.module.css";

export interface PitwallPreferencesState {
  audioEnabled: boolean;
  volume: number;
  reducedMotion: boolean;
  highContrast: boolean;
}

export function PitwallPreferences({ value, onChange, onClose, onReplayTour }: { value: PitwallPreferencesState; onChange: (value: PitwallPreferencesState) => void; onClose: () => void; onReplayTour: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section aria-label="Pitwall preferences" aria-modal="true" className={styles.panel} role="dialog">
        <header>
          <span><Gauge aria-hidden="true" size={20} /></span>
          <div><small>DISPLAY & AUDIO</small><h2 className="formula-title">Pitwall settings</h2></div>
          <button aria-label="Close settings" onClick={onClose} ref={closeRef} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className={styles.options}>
          <label><span>{value.audioEnabled ? <Volume2 aria-hidden="true" size={19} /> : <VolumeX aria-hidden="true" size={19} />}<strong>Alert audio</strong><small>Radio priority and Race Control tones</small></span><input checked={value.audioEnabled} onChange={(event) => onChange({ ...value, audioEnabled: event.target.checked })} type="checkbox" /></label>
          <label className={styles.range}><span><Volume2 aria-hidden="true" size={19} /><strong>Volume</strong><small>{Math.round(value.volume * 100)}%</small></span><input aria-label="Alert volume" disabled={!value.audioEnabled} max="1" min="0" onChange={(event) => onChange({ ...value, volume: Number(event.target.value) })} step="0.05" type="range" value={value.volume} /></label>
          <label><span><Gauge aria-hidden="true" size={19} /><strong>Reduced motion</strong><small>Stops decorative pulses and transitions</small></span><input checked={value.reducedMotion} onChange={(event) => onChange({ ...value, reducedMotion: event.target.checked })} type="checkbox" /></label>
          <label><span><Contrast aria-hidden="true" size={19} /><strong>High contrast</strong><small>Raises borders and secondary text</small></span><input checked={value.highContrast} onChange={(event) => onChange({ ...value, highContrast: event.target.checked })} type="checkbox" /></label>
          <button className={styles.replayTour} onClick={onReplayTour} type="button"><HelpCircle aria-hidden="true" size={19} /><span><strong>Replay quick start</strong><small>Open the first-weekend guide again</small></span></button>
        </div>
      </section>
    </div>
  );
}
