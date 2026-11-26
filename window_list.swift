import CoreGraphics
import Foundation

// List only visible QQ / WeChat chat windows. The bridge uses the numeric
// window id with `screencapture -l`; arbitrary windows are never returned.
let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
let raw = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
var rows: [[String: Any]] = []
for item in raw {
    let owner = String(describing: item[kCGWindowOwnerName as String] ?? "")
    let title = String(describing: item[kCGWindowName as String] ?? "")
    let haystack = (owner + " " + title).lowercased()
    let isChat = haystack.contains("qq") ||
        haystack.contains("wechat") ||
        haystack.contains("weixin") ||
        haystack.contains("微信")
    guard isChat else { continue }
    guard let number = item[kCGWindowNumber as String] as? Int, number > 0 else { continue }
    guard let layer = item[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
    rows.append([
        "id": number,
        "app": owner,
        "title": title,
        "width": (item[kCGWindowBounds as String] as? [String: Any])?["Width"] ?? 0,
        "height": (item[kCGWindowBounds as String] as? [String: Any])?["Height"] ?? 0,
    ])
}
if let data = try? JSONSerialization.data(withJSONObject: rows, options: []),
   let text = String(data: data, encoding: .utf8) {
    print(text)
}
