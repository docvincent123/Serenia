import QtQuick
import QtQuick.Controls

ComboBox {
    id: control
    implicitHeight: 46
    leftPadding: 14
    rightPadding: 36
    font.pixelSize: 14
    contentItem: Text {
        text: control.displayText
        textFormat: Text.PlainText
        color: control.enabled ? "#11212D" : "#5B6770"
        font: control.font
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }
    indicator: Label {
        x: control.width - width - 14
        y: (control.height - height) / 2
        text: "⌄"; font.pixelSize: 20; color: "#4A5C6A"
    }
    background: Rectangle {
        radius: 12; color: "white"
        border.color: control.activeFocus ? "#253745" : "#CCD0CF"
        border.width: control.activeFocus ? 2 : 1
    }
    delegate: ItemDelegate {
        id: option
        objectName: "care-option-" + index
        required property int index
        width: control.width - 12
        implicitHeight: 44
        text: control.textAt(index)
        highlighted: control.highlightedIndex === index
        contentItem: Label {
            text: option.text; textFormat: Text.PlainText; elide: Text.ElideRight
            color: "#11212D"; verticalAlignment: Text.AlignVCenter
        }
        background: Rectangle { radius: 8; color: option.highlighted ? "#DEE7EB" : option.hovered ? "#F1F4F5" : "white" }
        ToolTip.visible: hovered
        ToolTip.text: text
    }
    popup: Popup {
        y: control.height + 4
        width: control.width
        padding: 6
        margins: 16
        implicitHeight: Math.min(300, list.contentHeight + 12)
        background: Rectangle { color: "white"; radius: 13; border.color: "#CCD0CF" }
        contentItem: ListView {
            id: list
            clip: true
            implicitHeight: contentHeight
            model: control.popup.visible ? control.delegateModel : null
            currentIndex: control.highlightedIndex
            ScrollBar.vertical: ScrollBar { }
        }
    }
    ToolTip.visible: hovered && displayText.length > 35
    ToolTip.text: displayText
}
