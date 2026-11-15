// The shell panel's Service (shell/omafire/Service.qml) against a fake
// omafire, headless; run by tests/shell-service.test.sh. Logs "SVC ok" or
// "SVC fail: ..." and quits. (Quickshell imports nothing outside its config
// folder, so the script copies this and Service.qml into one.)
import QtQuick
import Quickshell

ShellRoot {
  id: shell

  property var steps: []
  property int step: 0
  function fail(why) { console.log("SVC fail: step " + step + ": " + why); Qt.quit() }
  function expect(ok, why) { if (!ok) fail(why + " (lastError=" + JSON.stringify(svc.lastError) + ", ready=" + svc.ready + ", unreachable=" + svc.unreachable + ")") }

  Service {
    id: svc
    command: "/nonexistent/omafire"
  }

  // each step runs, then the next one 700 ms later
  Timer {
    interval: 700
    running: true
    repeat: true
    onTriggered: {
      var checks = [
        function() {   // no binary: unavailable, nothing read
          expect(svc.unreachable, "missing binary not unreachable")
          expect(svc.lastError.indexOf("could not be started") !== -1, "no unavailable message")
          expect(!svc.ready, "ready without a settings line")
          svc.command = Quickshell.env("FAKE_OMAFIRE")
        },
        function() {   // it runs now; its warning about the file is the banner
          expect(!svc.unreachable, "still unreachable once it runs")
          expect(svc.lastError.indexOf("keeping the last settings") !== -1, "warning not shown")
          expect(!svc.ready, "ready before the settings line")
        },
        function() {}, // the fake sends the settings after 1 s
        function() {   // the settings line clears the warning
          expect(svc.ready, "not ready after the settings line")
          expect(svc.lastError === "", "warning outlived the settings line")
          svc.set("nope", true)
        },
        function() {   // a refused set is the banner
          expect(svc.lastError.indexOf("unknown setting") !== -1, "refused set not shown")
          svc.set("glass", true)
        },
        function() {   // and the next successful set clears it
          expect(svc.lastError === "", "refused set outlived a successful one")
          console.log("SVC ok")
          Qt.quit()
        },
      ]
      if (shell.step >= checks.length) return
      checks[shell.step]()
      shell.step++
    }
  }
  Timer { interval: 15000; running: true; onTriggered: shell.fail("timed out") }
}
