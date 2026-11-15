// The omafire bar panel in a headless sway, driven by QtTest events; run by
// tests/shell/panel/run.sh. Prints "PH <check> ok|FAIL ..." lines and "PH done".
import QtQuick
import QtTest
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "omafire" as Omafire

ShellRoot {
  id: shell
  property var p: loader.item
  property int step: 0
  property var marks: ({})
  function check(name, ok, info) { console.log("PH " + name + " " + (ok ? "ok" : "FAIL") + (info !== undefined ? " " + JSON.stringify(info) : "")) }

  QtObject {
    id: fakeBar
    property string position: "top"
    property int barSize: 32
    property color foreground: "#c0caf5"
    property color barForeground: "#c0caf5"
    property color background: "#1a1b26"
    property color urgent: "#f7768e"
    property string fontFamily: "JetBrainsMono Nerd Font"
    property bool notch: false
  }

  PanelWindow {
    id: barWin
    anchors { top: true; left: true; right: true }
    implicitHeight: 32
    color: "#1a1b26"
    Item {
      anchors.right: parent.right
      anchors.rightMargin: 200
      width: 32; height: 32
      Loader {
        id: loader
        anchors.fill: parent
        source: Qt.resolvedUrl("omafire/Panel.qml")
        onLoaded: { item.bar = fakeBar; item.settings = { command: Quickshell.env("FAKE_OMAFIRE") } }
      }
    }
  }

  TestCase { id: tc; when: false }

  // every row delegate (objects with `row` and `firstOfSection`) by key
  function rowsByKey() {
    var out = {}, seen = [], stack = [p]
    while (stack.length) {
      var o = stack.pop()
      if (!o || seen.indexOf(o) !== -1) continue
      seen.push(o)
      if (o.row !== undefined && o.firstOfSection !== undefined && o.row) out[o.row.key] = o
      var lists = [o.children, o.data, o.contentItem ? [o.contentItem] : null]
      for (var l = 0; l < lists.length; l++) if (lists[l]) for (var i = 0; i < lists[l].length; i++) stack.push(lists[l][i])
    }
    return out
  }
  function surfaceOf(rowRoot) {
    for (var i = 0; i < rowRoot.children.length; i++) if (rowRoot.children[i].hasCursor !== undefined) return rowRoot.children[i]
    return null
  }
  function textsUnder(o, out) {
    out = out || []
    if (o.text !== undefined && o.visible && typeof o.text === "string" && o.text !== "") out.push(o.text)
    if (o.children) for (var i = 0; i < o.children.length; i++) textsUnder(o.children[i], out)
    return out
  }
  Process { id: shot; property string path: ""; command: ["grim", path] }
  Process { id: calls; command: ["cat", Quickshell.env("FAKE_STATE") + "/calls"]; stdout: StdioCollector { id: callsOut } }

  Timer {
    interval: 600; running: true; repeat: true
    onTriggered: {
      var s = shell.step++
      if (s === 0) { p.open() }
      else if (s === 1) {
        check("ready", p.config && p.config.glass === false && !p.needsRepair, p.config ? p.config.glass : null)
        var rows = rowsByKey()
        marks.tabNumbers = rows["tab-numbers"]
        check("hint drawn", textsUnder(rows["glass"]).indexOf("Translucent chrome over the desktop.") !== -1, textsUnder(rows["glass"]))
        shot.path = Quickshell.env("SHOT_DIR") + "/a-glass-off.png"; shot.running = true
      }
      else if (s === 2) {
        // park the pointer on New tab, moving so the gate takes it
        var surf = surfaceOf(rowsByKey()["new-tab"])
        tc.mouseMove(surf, 40, surf.height / 2)
        tc.mouseMove(surf, 60, surf.height / 2)
      }
      else if (s === 3) {
        check("pointer selects", p.selectedKey === "new-tab", p.selectedKey)
        // keyboard: cursor to Glass and toggle it; Opacity and Glass pages
        // appear above New tab, under the still pointer
        p.select("glass"); p.cursorActive = true
        p.adjust("glass", 0)
      }
      else if (s === 4) {}
      else if (s === 5) {
        var rows = rowsByKey()
        check("glass on", p.config.glass === true)
        check("cursor stays on the toggled row", p.selectedKey === "glass", p.selectedKey)
        check("delegate kept", rows["tab-numbers"] === marks.tabNumbers)
        var op = rows["opacity"]
        var slider = null, stack = [op]
        while (stack.length) { var o = stack.pop(); if (o.liveValue !== undefined && o.minimum !== undefined) { slider = o; break } for (var i = 0; i < o.children.length; i++) stack.push(o.children[i]) }
        check("slider starts at floor", slider && Math.abs(slider.minimum - 0.7) < 0.001, slider ? slider.minimum : null)
        check("floor hint", textsUnder(op).join("|").indexOf("readable from 70%") !== -1, textsUnder(op))
        shot.path = Quickshell.env("SHOT_DIR") + "/b-glass-on.png"; shot.running = true
      }
      else if (s === 6) {
        var seen = [], stack = [p], catcher = null
        while (stack.length && !catcher) {
          var o = stack.pop(); if (!o || seen.indexOf(o) !== -1) continue; seen.push(o)
          if (typeof o.textKey === "function") { catcher = o; break }
          var lists = [o.children, o.data, o.contentItem ? [o.contentItem] : null]
          for (var l = 0; l < lists.length; l++) if (lists[l]) for (var i = 0; i < lists[l].length; i++) stack.push(lists[l][i])
        }
        check("key catcher found", catcher !== null)
        if (catcher) catcher.textKey("r", 0)
      }
      else if (s === 7) { calls.running = true }
      else if (s === 8) {
        var log = callsOut.text
        check("r without repair need runs nothing", log.indexOf("setup") === -1, log.split("\n").filter(function(l) { return l && l.indexOf("status") === -1 && l.indexOf("watch") === -1 }))
        console.log("PH done"); Qt.quit()
      }
    }
  }
  Timer { interval: 20000; running: true; onTriggered: { console.log("PH timeout"); Qt.quit() } }
}
