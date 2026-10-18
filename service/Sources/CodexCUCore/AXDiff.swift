import Foundation

/// Approximate tree diff in the shape the original emits: unchanged nodes are
/// skipped, changed nodes are prefixed with `~`, added nodes with `+`, and
/// removed node IDs are summarized as ranges.
public enum AXDiff {
  public static func render(previous: [AXTree.Node], current: [AXTree.Node], app: String) -> String {
    var lines: [String] = []
    lines.append("The following is a diff from the previous accessibility tree for \(app).")
    lines.append("~ and + represent changed and added elements, respectively.")
    lines.append("")

    var previousByID: [Int: AXTree.Node] = [:]
    for node in previous { previousByID[node.id] = node }

    var currentIDs = Set<Int>()
    for node in current {
      currentIDs.insert(node.id)
      let line = renderLine(node)
      if let old = previousByID[node.id], signature(old) == signature(node) {
        continue
      }
      if previousByID[node.id] == nil {
        lines.append("+ " + line)
      } else {
        lines.append("~ " + line)
      }
    }

    let removed = previous.map(\.id).filter { !currentIDs.contains($0) }
    if !removed.isEmpty {
      lines.append("")
      lines.append("Removed element IDs: " + ranges(removed))
    }
    return lines.joined(separator: "\n")
  }

  static func signature(_ node: AXTree.Node) -> String {
    "\(node.depth)|\(node.role)|\(node.title)|\(node.value)"
  }

  static func renderLine(_ node: AXTree.Node) -> String {
    let indent = String(repeating: "  ", count: node.depth)
    var line = "\(indent)\(node.id) \(node.role)"
    if !node.title.isEmpty { line += " \"\(node.title)\"" }
    if !node.value.isEmpty { line += " value=\"\(node.value.prefix(80))\"" }
    return line
  }

  static func ranges(_ ids: [Int]) -> String {
    let sorted = ids.sorted()
    var ranges: [String] = []
    var start = sorted[0]
    var end = sorted[0]
    for id in sorted.dropFirst() {
      if id == end + 1 {
        end = id
      } else {
        ranges.append(start == end ? "\(start)" : "\(start)-\(end)")
        start = id
        end = id
      }
    }
    ranges.append(start == end ? "\(start)" : "\(start)-\(end)")
    return ranges.joined(separator: ", ")
  }
}
