"use client";

import { useCallback, useEffect, useRef } from "react";

import type { RaceSnapshot } from "@/domain/race";

export interface PitwallAudioSettings {
  enabled: boolean;
  volume: number;
}

const PRIORITY_FREQUENCY = { NORMAL: 520, WARNING: 760, URGENT: 980 } as const;

export function usePitwallAudio(snapshot: RaceSnapshot | null, settings: PitwallAudioSettings) {
  const contextRef = useRef<AudioContext | null>(null);
  const lastRadioId = useRef<string | null>(null);
  const lastControl = useRef(snapshot?.raceControl ?? "GREEN");

  const unlock = useCallback(() => {
    if (!settings.enabled) return;
    const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    contextRef.current ??= new AudioContextConstructor();
    void contextRef.current.resume();
  }, [settings.enabled]);

  const tone = useCallback((frequency: number, duration = 0.12) => {
    if (!settings.enabled || settings.volume <= 0) return;
    unlock();
    const context = contextRef.current;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, settings.volume * 0.055), context.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.02);
  }, [settings.enabled, settings.volume, unlock]);

  useEffect(() => {
    if (!snapshot || !settings.enabled) return;
    if (snapshot.raceControl !== lastControl.current) {
      tone(snapshot.raceControl === "RED_FLAG" ? 260 : snapshot.raceControl === "GREEN" ? 620 : 430, 0.2);
      lastControl.current = snapshot.raceControl;
    }
    const message = snapshot.radioMessages[0];
    if (!message || message.id === lastRadioId.current) return;
    lastRadioId.current = message.id;
    tone(PRIORITY_FREQUENCY[message.priority], message.priority === "URGENT" ? 0.22 : 0.11);
  }, [settings.enabled, snapshot, tone]);

  useEffect(() => {
    if (!settings.enabled) return;
    const handleFirstGesture = () => unlock();
    window.addEventListener("pointerdown", handleFirstGesture, { once: true });
    window.addEventListener("keydown", handleFirstGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", handleFirstGesture);
      window.removeEventListener("keydown", handleFirstGesture);
    };
  }, [settings.enabled, unlock]);

  useEffect(() => () => { void contextRef.current?.close(); }, []);

  return { unlock };
}
