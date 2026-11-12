import QtQuick
import QtQuick.Controls

TextArea {
    id: control
    color: enabled ? "#0C1C34" : "#52637D"
    placeholderTextColor: "#526A89"
    selectionColor: "#1764EF"
    selectedTextColor: "#FFFFFF"
    selectByMouse: true
    wrapMode: TextEdit.Wrap
    textFormat: TextEdit.PlainText
    leftPadding: 14; rightPadding: 14; topPadding: 12; bottomPadding: 12
    background: Rectangle {
        radius: 12; color: control.enabled ? "#FFFFFF" : "#EEF4FC"
        border.color: control.activeFocus ? "#1764EF" : "#CFDDF0"
        border.width: control.activeFocus ? 2 : 1
    }
}
