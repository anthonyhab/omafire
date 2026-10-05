// Omafire pseudo-state actor (omafire-k9b.31.6): a page's own extension
// asks for :hover/:focus/:active to be held on elements, so a state can be
// looked at and audited without the pointer. Only chrome code may lock a
// pseudo-class (InspectorUtils.addPseudoClassLock); a content script cannot.
//
// The channel is the page's DOM, no file and no host: the requester sets
// data-omafire-pseudo-req on the root element to JSON
//   {"selector": "a.nav", "states": ["hover"]}   lock these on the matches
//   {"clear": true}                              release every lock
// and dispatches an "omafire:pseudo" event on the document; the answer is
// data-omafire-pseudo-res ({"matched": n, "locked": n}) once dispatch returns.
// Anything a page script can do here it can do to its own page only (it can
// already restyle itself), and the request never leaves the document.
const STATES = new Set([":hover", ":focus", ":active", ":focus-visible", ":focus-within"]);
const REQ = "data-omafire-pseudo-req";
const RES = "data-omafire-pseudo-res";
const MAX = 200;

export class OmafirePseudoChild extends JSWindowActorChild {
  locked = new Set();

  handleEvent(event) {
    if (event.type !== "omafire:pseudo") {
      return;
    }
    const doc = this.document;
    const root = doc.documentElement;
    let answer;
    try {
      const req = JSON.parse(root.getAttribute(REQ) || "{}");
      if (req.clear) {
        for (const el of this.locked) {
          InspectorUtils.clearPseudoClassLocks(el);
        }
        this.locked.clear();
        answer = { matched: 0, locked: 0 };
      } else {
        const states = (req.states || [":hover"]).map(s => (s.startsWith(":") ? s : ":" + s))
          .filter(s => STATES.has(s));
        const matches = [...doc.querySelectorAll(String(req.selector))].slice(0, MAX);
        for (const el of matches) {
          for (const state of states) {
            InspectorUtils.addPseudoClassLock(el, state);
          }
          this.locked.add(el);
        }
        answer = { matched: matches.length, locked: this.locked.size };
      }
    } catch (error) {
      answer = { error: String(error.message || error) };
    }
    root.setAttribute(RES, JSON.stringify(answer));
  }
}
export class OmafirePseudoParent extends JSWindowActorParent {}
