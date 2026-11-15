// The new tab with a cached feed answer it can't draw (fxlab js, chrome
// context, omafire.newtab on and the scripts loaded: fxlab up --scripts
// omafire/chrome --pref omafire.newtab=true). Overwrites the scratch
// profile's new tab settings and widget cache. Returns what each widget
// shows and a `fail` list:
//   AC1  the widgets beside it still paint (a cached feed, a local widget)
//   AC2  the bad answer is dropped from the cache and fetched again: its
//        widget says "Could not load" (its feed is on .invalid), never blank
// Before the fix (mu-884) no widget painted at all.
const A = "https://feed.invalid/a.xml", B = "https://feed.invalid/b.xml";
const CACHE = PathUtils.join(PathUtils.profileDir, "omafire-newtab-cache.json");
Services.prefs.setStringPref("omafire.newtab.settings", JSON.stringify({
  widgets: [{ type: "rss", option: A }, { type: "rss", option: B }, { type: "closed" }],
}));
const now = Date.now();
await IOUtils.writeJSON(CACHE, {
  [`rss:${A}:`]: { at: now, data: "a shape this version can't draw" },
  [`rss:${B}:`]: { at: now, data: { title: "Feed B", items: [{ url: "https://example.org/b", title: "cached-b" }] } },
});
const tab = gBrowser.addTrustedTab("chrome://omafire/content/newtab.html");
gBrowser.selectedTab = tab;
const doc = () => tab.linkedBrowser.contentDocument;
const bodies = () => [...(doc()?.querySelectorAll(".widget-body") ?? [])].map(b => b.textContent.trim());
for (let i = 0; i < 50 && !(bodies()[0] ?? "").includes("Could not load"); i++) {
  await new Promise(r => setTimeout(r, 100));
}
const shown = bodies();
await new Promise(r => setTimeout(r, 300)); // the cache write after the paint
const cache = await IOUtils.readJSON(CACHE);
const fail = [];
if (!shown[1]?.includes("cached-b")) fail.push(`AC1 cached feed: ${JSON.stringify(shown[1])}`);
if (!shown[2]) fail.push("AC1 local widget blank");
if (!shown[0]?.includes("Could not load")) fail.push(`AC2 bad widget: ${JSON.stringify(shown[0])}`);
if (`rss:${A}:` in cache) fail.push("AC2 bad answer still cached");
gBrowser.removeTab(tab);
return { shown, fail };
