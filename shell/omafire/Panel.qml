pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Omafire in the bar: Firefox's settings from ~/.config/omafire/config.json
// and the state of each browser profile, with a repair button. Every change
// goes through the omafire CLI; Firefox follows the file live.
//
// Keyboard: j/k or arrows move, h/l or left/right change the value, Enter or
// Space toggles or cycles, r repairs, Esc closes.
Panel {
  id: root
  moduleName: "omafire"
  ipcTarget: "omafire"

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color accent: Color.accent
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property var config: omafire.config
  readonly property var rows: Model.visibleRows(config)
  readonly property var summary: Model.summary(omafire.status)
  readonly property bool needsRepair: summary.broken.length > 0

  // The cursor tracks a row key ("repair" for the button): rows come and
  // go as settings change.
  property bool cursorActive: false
  property string selectedKey: ""
  property int lastIndex: 0
  // The chord row being recorded ("" when none), and why the last key
  // pressed was not taken.
  property string recording: ""
  property string recordHint: ""
  readonly property var cursorKeys: {
    var keys = rows.map(function(r) { return r.key })
    if (needsRepair) keys.push("repair")
    return keys
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onOpenedChanged: if (opened) {
    cursorActive = false
    select(cursorKeys.length > 0 ? cursorKeys[0] : "")
    omafire.refreshStatus()
    Qt.callLater(function() { keys.forceActiveFocus() })
  }
  onCursorKeysChanged: {
    if (selectedKey !== "" && cursorKeys.indexOf(selectedKey) === -1)
      select(cursorKeys[Math.max(0, Math.min(cursorKeys.length - 1, lastIndex))] || "")
  }

  function select(key) {
    selectedKey = String(key || "")
    var index = cursorKeys.indexOf(selectedKey)
    if (index !== -1) lastIndex = index
  }

  function hover(key) {
    cursorActive = true
    select(key)
  }

  function moveCursor(delta) {
    if (!cursorActive) {
      cursorActive = true
      if (cursorKeys.indexOf(selectedKey) !== -1) return
    }
    var index = cursorKeys.indexOf(selectedKey)
    var next = index === -1 ? lastIndex : index + delta
    select(cursorKeys[Math.max(0, Math.min(cursorKeys.length - 1, next))] || "")
  }

  // delta: -1/+1 from left/right; 0 from Enter/Space.
  function adjust(key, delta) {
    if (key === "repair") {
      if (delta === 0) omafire.repair()
      return
    }
    var row = rows[Model.rowIndex(rows, key)]
    if (!row) return
    var value = config[row.key]
    if (row.type === "toggle") omafire.set(row.key, delta === 0 ? !value : delta > 0)
    else if (row.type === "choice") omafire.set(row.key, Model.stepChoice(row.options, value, delta === 0 ? 1 : delta, delta === 0))
    else if (row.type === "slider" && delta !== 0) omafire.set(row.key, Model.stepSlider(row, value, delta))
    else if (row.type === "chord" && delta === 0) {
      recordHint = ""
      recording = row.key
      Qt.callLater(function() { recorder.forceActiveFocus() })
    }
  }

  function stopRecording() {
    recording = ""
    Qt.callLater(function() { keys.forceActiveFocus() })
  }

  Service {
    id: omafire
    command: root.setting("command", "omafire")
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "\uDB80\uDE39"   // nf-md-firefox
    // The urgent colour when a profile or the hook needs setup.
    active: root.needsRepair
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) omafire.set("glass", !(root.config.glass === true))
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keys
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(layout.implicitHeight, Style.space(720))

    PanelKeyCatcher {
      id: keys
      anchors.fill: parent
      blocked: root.recording !== ""
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) {
        if (dy !== 0) root.moveCursor(dy)
        else if (dx !== 0) {
          root.cursorActive = true
          root.adjust(root.selectedKey, dx)
        }
      }
      onActivateRequested: {
        root.cursorActive = true
        root.adjust(root.selectedKey, 0)
      }
      onTextKey: function(t) {
        if (t === "r" || t === "R") omafire.repair()
      }

      // Takes the keys while a chord row records: a chord is a modifier
      // (Ctrl, Alt or Super) and a letter or digit, the form keys.uc.js reads.
      Item {
        id: recorder
        focus: false
        Keys.onPressed: function(event) {
          event.accepted = true
          var k = event.key
          if (k === Qt.Key_Escape) { root.stopRecording(); return }
          if (k === Qt.Key_Backspace || k === Qt.Key_Delete) {
            omafire.set(root.recording, "")
            root.stopRecording()
            return
          }
          if (k === Qt.Key_Shift || k === Qt.Key_Control || k === Qt.Key_Alt
              || k === Qt.Key_Meta || k === Qt.Key_AltGr || k === Qt.Key_Super_L || k === Qt.Key_Super_R) return
          var ctrl = (event.modifiers & Qt.ControlModifier) !== 0
          var alt = (event.modifiers & Qt.AltModifier) !== 0
          var sup = (event.modifiers & Qt.MetaModifier) !== 0
          var shift = (event.modifiers & Qt.ShiftModifier) !== 0
          var isChar = (k >= Qt.Key_A && k <= Qt.Key_Z) || (k >= Qt.Key_0 && k <= Qt.Key_9)
          if (!isChar || !(ctrl || alt || sup)) {
            root.recordHint = "Ctrl/Alt/Super + a key"
            return
          }
          var parts = []
          if (ctrl) parts.push("Ctrl")
          if (alt) parts.push("Alt")
          if (shift) parts.push("Shift")
          if (sup) parts.push("Super")
          parts.push(String.fromCharCode(k))
          omafire.set(root.recording, parts.join("+"))
          root.stopRecording()
        }
      }

      // Scrolls when the screen is shorter than the panel.
      Flickable {
        id: flick
        anchors.fill: parent
        contentWidth: width
        contentHeight: layout.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

      Column {
        id: layout
        width: flick.width
        spacing: Style.space(2)

        PanelHero {
          width: parent.width
          title: "Omafire"
          meta: root.summary.meta
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconComponent: Component {
            Text {
              textFormat: Text.PlainText
              text: "\uDB80\uDE39"
              color: root.needsRepair ? root.urgent : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }
        }

        Text {
          textFormat: Text.PlainText
          visible: omafire.lastError !== ""
          width: parent.width
          bottomPadding: Style.space(4)
          text: omafire.lastError
          color: root.urgent
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }

        Repeater {
          model: root.rows

          Column {
            id: rowRoot

            required property var modelData
            required property int index

            readonly property var row: modelData
            readonly property bool firstOfSection: index === 0 || root.rows[index - 1].section !== row.section
            readonly property bool current: root.cursorActive && root.selectedKey === row.key
            readonly property var value: root.config[row.key]

            width: layout.width
            spacing: Style.space(2)

            PanelSeparator {
              visible: rowRoot.firstOfSection && rowRoot.index > 0
              width: parent.width
              foreground: root.foreground
            }

            PanelSectionHeader {
              visible: rowRoot.firstOfSection
              text: rowRoot.row.section
              foreground: root.foreground
              fontFamily: root.fontFamily
              topPadding: Style.space(4)
            }

            CursorSurface {
              width: parent.width
              height: rowBody.implicitHeight + Style.space(12)
              hasCursor: rowRoot.current
              foreground: root.foreground
              accent: root.accent

              HoverHandler {
                onHoveredChanged: if (hovered) root.hover(rowRoot.row.key)
              }

              // A toggle row is one click target; choices and the slider
              // keep their own controls.
              MouseArea {
                anchors.fill: parent
                enabled: rowRoot.row.type === "toggle"
                cursorShape: Qt.PointingHandCursor
                onClicked: root.adjust(rowRoot.row.key, 0)
              }

              Column {
                id: rowBody
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: Style.space(8)
                anchors.rightMargin: Style.space(8)
                spacing: Style.space(6)

                Item {
                  width: parent.width
                  implicitHeight: Math.max(labelColumn.implicitHeight, trailing.implicitHeight)

                  Column {
                    id: labelColumn
                    anchors.left: parent.left
                    anchors.right: trailing.left
                    anchors.rightMargin: Style.space(8)
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.space(1)

                    Text {
                      textFormat: Text.PlainText
                      width: parent.width
                      text: rowRoot.row.label
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                      elide: Text.ElideRight
                    }

                  }

                  Row {
                    id: trailing
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.space(6)

                    ToggleSwitch {
                      visible: rowRoot.row.type === "toggle"
                      checked: rowRoot.value === true
                      interactive: false
                      foreground: root.foreground
                      accent: root.accent
                      anchors.verticalCenter: parent.verticalCenter
                    }

                    ButtonGroup {
                      visible: rowRoot.row.type === "choice"
                      options: rowRoot.row.options || []
                      value: String(rowRoot.value)
                      focusable: false
                      spacing: Style.space(4)
                      foreground: root.foreground
                      accent: root.accent
                      fontFamily: root.fontFamily
                      fontSize: Style.font.bodySmall
                      anchors.verticalCenter: parent.verticalCenter
                      onChanged: function(v) { omafire.set(rowRoot.row.key, v) }
                    }

                    // A shortcut: Enter records a new one (Esc cancels, Backspace turns it
                    // off); `omafire set key-... Ctrl+Alt+Z` does the same from a shell.
                    Text {
                      readonly property bool recording: root.recording === rowRoot.row.key
                      textFormat: Text.PlainText
                      visible: rowRoot.row.type === "chord"
                      // keys.uc.js leaves a chord the browser already uses unbound
                      // and reports it through `omafire status`.
                      readonly property var clash: {
                        var all = omafire.status ? omafire.status.keyConflicts : null
                        var c = all ? all[rowRoot.row.key] : null
                        return c && c.chord === String(rowRoot.value) ? c : null
                      }
                      text: recording ? (root.recordHint || "press the new chord")
                          : clash ? String(rowRoot.value) + "  taken by " + clash.owner
                          : (String(rowRoot.value) || "off")
                      color: recording ? root.accent : clash ? root.urgent : root.foreground
                      opacity: recording || clash || String(rowRoot.value) ? 1 : 0.6
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                      anchors.verticalCenter: parent.verticalCenter
                    }

                    Text {
                      textFormat: Text.PlainText
                      visible: rowRoot.row.type === "slider"
                      text: Math.round(Number(rowRoot.value) * 100) + "%"
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                      anchors.verticalCenter: parent.verticalCenter
                    }
                  }
                }

                PanelSlider {
                  visible: rowRoot.row.type === "slider"
                  width: parent.width
                  bar: root.bar
                  minimum: rowRoot.row.min || 0
                  maximum: rowRoot.row.max || 1
                  step: rowRoot.row.step || 0.01
                  value: Number(rowRoot.value)
                  onReleased: function(v) { omafire.set(rowRoot.row.key, Math.round(v * 100) / 100) }
                }
              }
            }
          }
        }

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
        }

        PanelSectionHeader {
          text: "PROFILES"
          foreground: root.foreground
          fontFamily: root.fontFamily
          topPadding: Style.space(4)
        }

        Repeater {
          model: root.summary.profiles

          Item {
            required property var modelData
            width: layout.width
            implicitHeight: profileText.implicitHeight + Style.space(6)

            Text {
              id: profileText
              textFormat: Text.PlainText
              anchors.left: parent.left
              anchors.right: profileState.left
              anchors.leftMargin: Style.space(8)
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              text: modelData.browser + " · " + modelData.name
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
            }

            Text {
              id: profileState
              textFormat: Text.PlainText
              anchors.right: parent.right
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              text: modelData.status
              color: modelData.ok ? root.dim : root.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
        }

        Text {
          textFormat: Text.PlainText
          visible: root.summary.profiles.length === 0 && omafire.status !== null
          width: parent.width
          leftPadding: Style.space(8)
          text: "No Firefox profiles found."
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        CursorSurface {
          visible: root.needsRepair
          width: parent.width
          height: repairText.implicitHeight + Style.space(14)
          hasCursor: root.cursorActive && root.selectedKey === "repair"
          bordered: true
          foreground: root.foreground
          accent: root.accent

          HoverHandler {
            onHoveredChanged: if (hovered) root.hover("repair")
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: omafire.repairing ? Qt.BusyCursor : Qt.PointingHandCursor
            enabled: !omafire.repairing
            onClicked: omafire.repair()
          }

          Text {
            id: repairText
            textFormat: Text.PlainText
            anchors.centerIn: parent
            text: omafire.repairing ? "Setting up…" : "Repair (omafire setup)"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            font.bold: true
          }
        }
      }
      }
    }
  }
}
