import type { JSX } from "react";
export function mxShare(o: { title?: string; text?: string; path?: string; okMsg?: string; toast: (text: string, kind?: "ok" | "bad") => void }): Promise<void>;
export function mxCurrentPath(): string;
export const MX_FX: Record<"buy" | "sell" | "win" | "deal", (sub?: string) => void>;
export function __mxAfterCall(name: string, args: Record<string, unknown>, res: unknown): void;
export function MxFxWatcher(): null;
export function MxSoundSetting(): JSX.Element;
