/**
 * Brücke zur nativen iOS-Hülle (Capacitor). Im Browser tut alles hier nichts bzw. fällt
 * auf die Web-Variante zurück: jede Funktion prüft zuerst, ob wir in der App laufen.
 * Plugins werden erst bei Bedarf geladen (dynamic import), damit der Web-Bundle klein bleibt.
 */

import { Capacitor } from "@capacitor/core";

export function isNativeApp(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export type HapticKind = "tick" | "light" | "medium" | "success";

/** Kurze Vibration. Fehler (Plugin fehlt, Gerät kann nicht) werden verschluckt. */
export function haptic(kind: HapticKind): void {
  if (!isNativeApp()) return;
  void import("@capacitor/haptics").then(({ Haptics, ImpactStyle, NotificationType }) => {
    if (kind === "success") return Haptics.notification({ type: NotificationType.Success });
    if (kind === "tick") return Haptics.selectionChanged();
    return Haptics.impact({ style: kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light });
  }).catch(() => { /* egal */ });
}

/** Bildschirm wach halten (Rezept offen) bzw. wieder freigeben. */
export function keepScreenAwake(on: boolean): void {
  if (!isNativeApp()) return;
  void import("@capacitor-community/keep-awake").then(({ KeepAwake }) =>
    on ? KeepAwake.keepAwake() : KeepAwake.allowSleep(),
  ).catch(() => { /* egal */ });
}

/**
 * Natives Teilen-Menü der App. true = erledigt (geteilt oder abgebrochen),
 * false = nicht in der App oder nicht möglich → Aufrufer nimmt den Web-Weg.
 */
export async function nativeShare(o: { title?: string; text?: string; url?: string }): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { Share } = await import("@capacitor/share");
    const can = await Share.canShare();
    if (!can.value) return false;
    await Share.share({ title: o.title, text: o.text, url: o.url, dialogTitle: o.title });
    return true;
  } catch (e) {
    // Abbrechen des Menüs wirft "Share canceled": nicht als Fehler behandeln.
    return /cancel/i.test(String((e as Error)?.message ?? e));
  }
}
