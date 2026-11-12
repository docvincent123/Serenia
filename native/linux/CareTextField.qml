import QtQuick
import QtQuick.Controls

TextField {
    id: control
    color: enabled ? "#11212D" : "#5B6770"
    placeholderTextColor: "#586873"
    selectionColor: "#253745"
    selectedTextColor: "#FFFFFF"
    selectByMouse: true
    implicitHeight: 46
    leftPadding: 14; rightPadding: 14
    background: Rectangle {
        radius: 12; color: control.enabled ? "#FFFFFF" : "#EDF0F0"
        border.color: control.activeFocus ? "#253745" : "#CCD0CF"
        border.width: control.activeFocus ? 2 : 1
    }
}
