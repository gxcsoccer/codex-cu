import Testing
@testable import CodexCUCore

private func node(_ id: Int, _ role: String, _ title: String, value: String = "") -> AXTree.Node {
  AXTree.Node(id: id, role: role, title: title, value: value, depth: 0)
}

@Test func unchangedNodesAreOmitted() {
  let previous = [node(0, "AXWindow", "W"), node(1, "AXButton", "A")]
  let current = [node(0, "AXWindow", "W"), node(1, "AXButton", "A")]
  let diff = AXDiff.render(previous: previous, current: current, app: "app")
  let body = diff.split(separator: "\n").map(String.init)
  #expect(!body.contains { $0.range(of: #"^[~+]\t\d"#, options: .regularExpression) != nil })
}

@Test func changedAndAddedNodesAreMarked() {
  let previous = [node(0, "AXWindow", "W"), node(1, "AXButton", "A")]
  let current = [node(0, "AXWindow", "W"), node(1, "AXButton", "B"), node(2, "AXButton", "C")]
  let diff = AXDiff.render(previous: previous, current: current, app: "app")
  #expect(diff.contains("~\t1 AXButton B"))
  #expect(diff.contains("+\t2 AXButton C"))
}

@Test func removedIDsAreSummarizedAsRanges() {
  let previous = (0..<5).map { node($0, "AXButton", "B\($0)") }
  let current = [node(0, "AXButton", "B0")]
  let diff = AXDiff.render(previous: previous, current: current, app: "app")
  #expect(diff.contains("Removed element IDs: 1-4"))
}
