import QtQuick
import "CareVisuals.js" as Visuals
Image {
    property string name: "grid"
    property string tone: "ink"
    source: name ? (Visuals.icons[name + "-" + tone] || "") : ""
    sourceSize.width: 32; sourceSize.height: 32
    fillMode: Image.PreserveAspectFit
    width: 24; height: 24
    smooth: true
}
