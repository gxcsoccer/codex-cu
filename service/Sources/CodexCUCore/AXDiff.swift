import Foundation

/// Diff in the observed format: header with window title, removed IDs first,
/// then `~`/`+` lines prefixed with a tab, then the `Selected:` block.
public enum AXDiff {
  public static func render(previous: [AXTree.Node], current: [AXTree.Node],
                            app: String, window: String = "") -> String {
    let title = window.isEmpty ? app : window
    var lines = [
      "The following is a diff from the previous accessibility tree for Window: \"\(title)\" with ~ and + representing changed and added elements, respectively. Removed elements are summarized by ID range.",
    ]

    var previousByID: [Int: AXTree.Node] = [:]
    for node in previous { previousByID[node.id] = node }

    let currentIDs = Set(current.map(\.id))
    let removed = previous.map(\.id).filter { !currentIDs.contains($0) }
    if !removed.isEmpty {
      lines.append("Removed element IDs: " + ranges(removed))
    }

    for node in current {
      let line = plain(node)
      if let old = previousByID[node.id], signature(old) == signature(node) { continue }
      let prefix = previousByID[node.id] == nil ? "+" : "~"
      lines.append("\(prefix)\t\(line)")
    }

    let selected = current.filter { $0.states.contains("selected") }
    if !selected.isEmpty {
      lines.append("")
      lines.append("Selected:")
      for node in selected { lines.append("\t" + plain(node)) }
      lines.append("")
      lines.append("Note: Pay special attention to the content selected by the user. If the user asks a question or refers to the content they are looking at on-screen, they might be referring to the selected content (but they might be referring to something else that's visible, too).")
    }
    return lines.joined(separator: "\n")
  }

  /// Node line without indentation, used inside diffs.
  static func plain(_ node: AXTree.Node) -> String {
    var copy = node
    copy = AXTree.Node(id: node.id, role: node.role, roleDescription: node.roleDescription,
                       title: node.title, description: node.description, identifier: node.identifier,
                       url: node.url, value: node.value, valueIsNumber: node.valueIsNumber,
                       states: node.states, secondaryActions: node.secondaryActions, depth: 0)
    return AXTree.line(copy)
  }

  static func signature(_ node: AXTree.Node) -> String {
    "\(node.depth)|\(node.displayRole)|\(node.title)|\(node.description)|\(node.identifier)|\(node.url)|\(node.value)|\(node.valueIsNumber)|\(node.states.joined(separator: ","))|\(node.secondaryActions.joined(separator: ","))"
  }

  static func ranges(_ ids: [Int]) -> String {
    let sorted = ids.sorted()
    guard let first = sorted.first else { return "" }
    var ranges: [String] = []
    var start = first
    var end = first
    for id in sorted.dropFirst() {
      if id == end + 1 { end = id } else {
        ranges.append(start == end ? "\(start)" : "\(start)-\(end)")
        start = id; end = id
      }
    }
    ranges.append(start == end ? "\(start)" : "\(start)-\(end)")
    return ranges.joined(separator: ", ")
  }
}
