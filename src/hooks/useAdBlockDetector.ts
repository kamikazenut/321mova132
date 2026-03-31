"use client";

import { useEffect, useState } from "react";

const CHECK_DELAY_MS = 150;
const SCRIPT_PROBE_TIMEOUT_MS = 2000;
const SCRIPT_CONFIRM_DELAY_MS = 300;
const PROBE_AVAILABILITY_TIMEOUT_MS = 1200;
const VISIBILITY_RECHECK_DELAY_MS = 250;
const BAIT_BLOCKED_THRESHOLD = 2;
const SCRIPT_PROBE_MINIMUM_COUNT = 3;
const SCRIPT_PROBE_BLOCKED_THRESHOLD = 3;

const BAIT_SELECTORS = [
  { id: "ad_banner", className: "adsbox ad-banner ad-placement textads pub_300x250" },
  { id: "google_ads_iframe_1", className: "advertisement sponsored promoted" },
];

const LOCAL_PROBE_SCRIPT_URLS = ["/ads.js", "/adservice.js", "/banner-ad.js", "/prebid-ads.js"];

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const ensureBodyReady = async () => {
  if (typeof document === "undefined") return;
  if (document.body) return;

  for (let i = 0; i < 10; i += 1) {
    await wait(50);
    if (document.body) return;
  }
};

const isElementBlocked = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);

  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0" ||
    element.offsetHeight === 0 ||
    element.offsetWidth === 0
  );
};

const detectByBait = async (): Promise<number> => {
  await ensureBodyReady();
  if (!document.body) return 0;

  if (typeof window === "undefined" || typeof document === "undefined") return 0;

  const baits = BAIT_SELECTORS.map(({ id, className }) => {
    const bait = document.createElement("div");
    bait.id = id;
    bait.className = className;
    bait.setAttribute("aria-hidden", "true");
    bait.style.cssText =
      "position:absolute;left:-9999px;top:-9999px;width:10px;height:10px;pointer-events:none;";
    document.body.appendChild(bait);
    return bait;
  });

  await wait(CHECK_DELAY_MS);

  const blockedCount = baits.reduce((count, bait) => {
    const blocked = !bait.isConnected || isElementBlocked(bait);
    return blocked ? count + 1 : count;
  }, 0);

  baits.forEach((bait) => {
    if (bait.isConnected) bait.remove();
  });

  return blockedCount;
};

const canReachLocalProbe = async (url: string): Promise<boolean> => {
  if (typeof window === "undefined") return false;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PROBE_AVAILABILITY_TIMEOUT_MS);
  const separator = url.includes("?") ? "&" : "?";

  try {
    const response = await fetch(`${url}${separator}health=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const detectByScriptProbe = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(false);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = `${url}?cb=${Date.now()}`;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";

    let settled = false;
    const settle = (blocked: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (script.parentNode) script.parentNode.removeChild(script);
      resolve(blocked);
    };

    // Timeout is treated as unknown (not blocked) to reduce false positives.
    const timeoutId = window.setTimeout(() => settle(false), SCRIPT_PROBE_TIMEOUT_MS);
    script.onload = () => settle(false);
    script.onerror = () => settle(true);

    (document.head || document.documentElement).appendChild(script);
  });

interface AdBlockSignals {
  baitBlockedCount: number;
  localBlockedCount: number;
  localProbeCount: number;
}

const detectAdBlockSignals = async (): Promise<AdBlockSignals> => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { baitBlockedCount: 0, localBlockedCount: 0, localProbeCount: 0 };
  }

  const baitBlockedCount = await detectByBait();
  const availableChecks = await Promise.all(
    LOCAL_PROBE_SCRIPT_URLS.map(async (url) => (await canReachLocalProbe(url) ? url : null)),
  );
  const activeProbeUrls = availableChecks.filter((url): url is string => Boolean(url));

  const localProbeResults = await Promise.all(activeProbeUrls.map((url) => detectByScriptProbe(url)));

  return {
    baitBlockedCount,
    localBlockedCount: localProbeResults.filter(Boolean).length,
    localProbeCount: activeProbeUrls.length,
  };
};

const getScriptBlockedThreshold = (probeCount: number): number =>
  Math.max(SCRIPT_PROBE_BLOCKED_THRESHOLD, Math.ceil(probeCount * 0.75));

const isScriptSignalBlocked = (signals: AdBlockSignals): boolean => {
  if (signals.localProbeCount < SCRIPT_PROBE_MINIMUM_COUNT) return false;
  return signals.localBlockedCount >= getScriptBlockedThreshold(signals.localProbeCount);
};

const detectAdBlock = async (): Promise<boolean> => {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (document.visibilityState !== "visible") return false;

  const initialSignals = await detectAdBlockSignals();
  if (initialSignals.baitBlockedCount >= BAIT_BLOCKED_THRESHOLD) return true;
  if (!isScriptSignalBlocked(initialSignals)) return false;

  await wait(SCRIPT_CONFIRM_DELAY_MS);
  if (document.visibilityState !== "visible") return false;

  const confirmedSignals = await detectAdBlockSignals();
  return (
    confirmedSignals.baitBlockedCount >= BAIT_BLOCKED_THRESHOLD ||
    isScriptSignalBlocked(confirmedSignals)
  );
};

const useAdBlockDetector = () => {
  const [isAdBlockDetected, setIsAdBlockDetected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let disposed = false;
    let timeoutId: number | null = null;

    const runDetection = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      try {
        const blocked = await detectAdBlock();
        if (!disposed) setIsAdBlockDetected(blocked);
      } catch {
        if (!disposed) setIsAdBlockDetected(false);
      } finally {
        if (!disposed) setIsChecking(false);
      }
    };

    const scheduleDetection = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void runDetection();
      }, VISIBILITY_RECHECK_DELAY_MS);
    };

    void runDetection();
    document.addEventListener("visibilitychange", scheduleDetection);
    window.addEventListener("focus", scheduleDetection);

    return () => {
      disposed = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", scheduleDetection);
      window.removeEventListener("focus", scheduleDetection);
    };
  }, []);

  return { isAdBlockDetected, isChecking };
};

export default useAdBlockDetector;
