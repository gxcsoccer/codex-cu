import AppKit
import ApplicationServices

/// Minimal accessibility-tree renderer: stable element IDs, roles, titles.
/// The original renders a richer text representation (states, actions, diffs);
/// this is the substrate for that work.
public enum AXTree {
  public struct Node {
    public let id: Int
    public let role: String
    public let title: String
    public let value: String
    public let depth: Int
  }

  public struct Snapshot {
    public let nodes: [Node]
    public let elements: [Int: AXUIElement]
  }

  public static func snapshot(pid: pid_t, maxDepth: Int = 8, maxNodes: Int = 2000) throws -> Snapshot {
    let app = AXUIElementCreateApplication(pid)
    var nodes: [Node] = []
    var elements: [Int: AXUIElement] = [:]
    var counter = 0

    func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
      var value: CFTypeRef?
      guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
      return value as AnyObject?
    }

    func walk(_ element: AXUIElement, depth: Int) {
      guard depth <= maxDepth, nodes.count < maxNodes else { return }
      let role = attribute(element, kAXRoleAttribute) as? String ?? "AXUnknown"
      let title = attribute(element, kAXTitleAttribute) as? String ?? ""
      let value = attribute(element, kAXValueAttribute) as? String ?? ""
      let id = counter
      nodes.append(Node(id: id, role: role, title: title, value: value, depth: depth))
      elements[id] = element
      counter += 1
      if let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
        for child in children { walk(child, depth: depth + 1) }
      }
    }

    walk(app, depth: 0)
    return Snapshot(nodes: nodes, elements: elements)
  }

  public static func render(_ nodes: [Node]) -> String {
    nodes.map { node in
      let indent = String(repeating: "  ", count: node.depth)
      var line = "\(indent)\(node.id) \(node.role)"
      if !node.title.isEmpty { line += " \"\(node.title)\"" }
      if !node.value.isEmpty { line += " value=\"\(node.value.prefix(80))\"" }
      return line
    }.joined(separator: "\n")
  }
}
