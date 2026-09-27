import QtQuick
import Quickshell.Io

// Omafire's state for the panel, all through the CLI (DEC-30):
//   settings  `omafire watch`, one JSON line per change, restarted if it dies
//   writes    `omafire set <key> <value>`, one at a time, latest value per key
//   status    `omafire status --json`, on open and after a repair
//   repair    `omafire setup`
QtObject {
  id: root

  property string command: "omafire"

  // What the file says, from the last watch line; {} until the first.
  property var watched: ({})
  // Writes not yet confirmed by the CLI: shown over `watched`, so a click
  // shows at once and a watch line that predates it cannot undo it.
  property var pending: ({})
  readonly property var config: {
    var out = {}
    for (var k in watched) out[k] = watched[k]
    for (var p in pending) out[p] = pending[p]
    return out
  }
  readonly property bool ready: Object.keys(watched).length > 0

  property var status: null
  property string lastError: ""
  readonly property bool repairing: repairProcess.running

  property var _queue: []   // keys waiting for `set`, oldest first

  function set(key, value) {
    var next = Object.assign({}, pending)
    next[key] = value
    pending = next
    if (_queue.indexOf(key) === -1) _queue = _queue.concat([key])
    _pump()
  }

  function _pump() {
    if (setProcess.running || _queue.length === 0) return
    var key = _queue[0]
    _queue = _queue.slice(1)
    var value = pending[key]
    setProcess.key = key
    setProcess.value = value
    setProcess.command = [command, "set", key, typeof value === "number"
      ? String(Math.round(value * 100) / 100) : String(value)]
    setProcess.running = true
  }

  function refreshStatus() {
    if (!statusProcess.running) statusProcess.running = true
  }

  function repair() {
    if (repairProcess.running) return
    lastError = ""
    repairProcess.running = true
  }

  function _takeLine(line) {
    var text = String(line || "").trim()
    if (text.charAt(0) !== "{") {
      if (text !== "") lastError = text   // the CLI's warning about the file
      return
    }
    try {
      watched = JSON.parse(text)
      if (lastError.indexOf("config.json") !== -1) lastError = ""
    } catch (e) {
      console.warn("omafire: unreadable watch line: " + text)
    }
  }

  property Process watchProcess: Process {
    command: [root.command, "watch"]
    running: false
    stdout: SplitParser { onRead: function(data) { root._takeLine(data) } }
    stderr: SplitParser { onRead: function(data) { root._takeLine(data) } }
    onExited: function(exitCode) {
      if (exitCode !== 0) root.lastError = "omafire watch stopped (" + exitCode + "); retrying"
    }
  }

  // Keeps the watch running. A process that cannot start never reports an
  // exit, and the widget's `command` setting can arrive after creation, so
  // this checks rather than waiting for a signal.
  property Timer supervisor: Timer {
    interval: 3000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: {
      if (!root.watchProcess.running) root.watchProcess.running = true
      if (root.status === null) root.refreshStatus()
    }
  }

  onCommandChanged: {
    watched = ({})
    status = null
    if (watchProcess.running) watchProcess.running = false
    Qt.callLater(function() { root.watchProcess.running = true; root.refreshStatus() })
  }

  property Process setProcess: Process {
    property string key: ""
    property var value: null
    running: false
    stderr: StdioCollector { id: setStderr; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) root.lastError = setStderr.text.trim() || ("omafire set failed (" + exitCode + ")")
      // A newer value for the same key stays pending for its own run.
      if (root._queue.indexOf(key) === -1 && root.pending[key] === value) {
        var next = Object.assign({}, root.pending)
        delete next[key]
        root.pending = next
      }
      root._pump()
    }
  }

  property Process statusProcess: Process {
    command: [root.command, "status", "--json"]
    running: false
    stdout: StdioCollector { id: statusStdout; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) return
      try {
        root.status = JSON.parse(statusStdout.text)
      } catch (e) {
        console.warn("omafire: unreadable status: " + statusStdout.text)
      }
    }
  }

  property Process repairProcess: Process {
    command: [root.command, "setup"]
    running: false
    stderr: StdioCollector { id: repairStderr; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) root.lastError = repairStderr.text.trim() || ("omafire setup failed (" + exitCode + ")")
      root.refreshStatus()
    }
  }
}
