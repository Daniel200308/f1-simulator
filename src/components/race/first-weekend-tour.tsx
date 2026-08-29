"use client";

import { BatteryCharging, ChevronRight, Flag, Radio, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "./first-weekend-tour.module.css";

const STEPS = [
  { icon: Flag, title: "Run the weekend", copy: "Practice builds setup knowledge. Qualifying fixes your grid, then the race awards championship points." },
  { icon: BatteryCharging, title: "Manage both cars", copy: "Pace, tyres and energy react independently. Automatic battery logic still shows deploy and harvest around each car." },
  { icon: Radio, title: "Listen to context", copy: "Race Control, weather, Safety Car and driver emotion now use separate radio priorities and alert tones." },
] as const;

export function FirstWeekendTour({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const onCompleteRef = useRef(onComplete);
  const current = STEPS[step];
  const Icon = current.icon;
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => {
    nextRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCompleteRef.current(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
  return <div className={styles.backdrop}><section aria-label="First weekend guide" aria-modal="true" className={styles.panel} role="dialog"><button aria-label="Skip guide" className={styles.close} onClick={onComplete} type="button"><X aria-hidden="true" size={18} /></button><span className={styles.icon}><Icon aria-hidden="true" size={28} /></span><small>QUICK START · {step + 1}/{STEPS.length}</small><h2 className="formula-title">{current.title}</h2><p>{current.copy}</p><div className={styles.progress}>{STEPS.map((_, index) => <i data-active={index <= step} key={index} />)}</div><button className={styles.next} onClick={() => step === STEPS.length - 1 ? onComplete() : setStep(step + 1)} ref={nextRef} type="button">{step === STEPS.length - 1 ? "Enter pitwall" : "Next"}<ChevronRight aria-hidden="true" size={17} /></button></section></div>;
}
