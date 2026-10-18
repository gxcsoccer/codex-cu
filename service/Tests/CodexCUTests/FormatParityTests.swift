import Testing
@testable import CodexCUCore

/// Pins the renderer to text captured from the real Codex service
/// (Finder, macOS 27, zh locale). If these change, the format drifted.
@Test func nodeLinesMatchTheObservedCapture() {
  let window = AXTree.Node(id: 0, role: "AXWindow", roleDescription: "标准窗口", title: "下载",
                           identifier: "FinderWindow", secondaryActions: ["Raise"], depth: 0)
  #expect(AXTree.line(window) == "0 标准窗口 下载, ID: FinderWindow, Secondary Actions: Raise")

  let row = AXTree.Node(id: 4, role: "AXRow", roleDescription: "row", title: "",
                        description: "时钟", value: "最近使用", states: ["selectable"], depth: 4)
  #expect(AXTree.line(row) == "\t\t\t\t4 row (selectable) Description: 时钟, Value: 最近使用")

  let scrollbar = AXTree.Node(id: 26, role: "AXScrollBar", roleDescription: "滚动条", title: "",
                              value: "0", valueIsNumber: true, states: ["settable", "float"], depth: 2)
  #expect(AXTree.line(scrollbar) == "\t\t26 滚动条 (settable, float) 0")
}

@Test func fullTreeHeaderMatchesTheObservedCapture() {
  let node = AXTree.Node(id: 0, role: "AXWindow", roleDescription: "标准窗口", title: "下载", depth: 0)
  let text = AXTree.render([node], app: "访达", window: "下载")
  #expect(text.hasPrefix("Window: \"下载\", App: 访达.\n"))
}

@Test func diffShapeMatchesTheObservedCapture() {
  let previous = [
    AXTree.Node(id: 0, role: "AXWindow", roleDescription: "标准窗口", title: "下载", depth: 0),
    AXTree.Node(id: 227, role: "AXButton", roleDescription: "按钮", title: "old", depth: 1),
  ]
  let current = [
    AXTree.Node(id: 0, role: "AXWindow", roleDescription: "标准窗口", title: "下载", depth: 0),
    AXTree.Node(id: 35, role: "AXRow", roleDescription: "row", title: "", states: ["selected"], depth: 2),
    AXTree.Node(id: 239, role: "AXStaticText", roleDescription: "文本", title: "下载", depth: 2),
  ]
  let diff = AXDiff.render(previous: previous, current: current, app: "访达", window: "下载")
  #expect(diff.hasPrefix("The following is a diff from the previous accessibility tree for Window: \"下载\" with ~ and + representing changed and added elements, respectively. Removed elements are summarized by ID range."))
  #expect(diff.contains("Removed element IDs: 227"))
  #expect(diff.contains("+\t239 文本 下载"))
  #expect(diff.contains("\nSelected:\n\t35 row (selected)\n"))
  #expect(diff.contains("Note: Pay special attention to the content selected by the user."))
}
