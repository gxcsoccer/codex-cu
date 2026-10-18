import AppKit
import ApplicationServices

/// Renders the accessibility tree in the format observed from the original
/// service: localized role descriptions, states, description/identifier/URL/
/// value, secondary actions, tab indentation and `Window:/App:` header.
public enum AXTree {
  public struct Node {
    public let id: Int
    public let role: String
    public let roleDescription: String
    public let title: String
    public let description: String
    public let identifier: String
    public let url: String
    public let value: String
    public let valueIsNumber: Bool
    public let states: [String]
    public let secondaryActions: [String]
    public let depth: Int

    public init(id: Int, role: String, roleDescription: String = "", title: String,
                description: String = "", identifier: String = "", url: String = "",
                value: String = "", valueIsNumber: Bool = false, states: [String] = [],
                secondaryActions: [String] = [], depth: Int) {
      self.id = id
      self.role = role
      self.roleDescription = roleDescription
      self.title = title
      self.description = description
      self.identifier = identifier
      self.url = url
      self.value = value
      self.valueIsNumber = valueIsNumber
      self.states = states
      self.secondaryActions = secondaryActions
      self.depth = depth
    }

    /// Role shown to the model: the localized role description when present.
    public var displayRole: String { roleDescription.isEmpty ? role : roleDescription }
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

    func string(_ element: AXUIElement, _ name: String) -> String {
      if let value = attribute(element, name) as? String { return value }
      return ""
    }

    func isSettable(_ element: AXUIElement, _ name: String) -> Bool {
      var flag = DarwinBoolean(false)
      return AXUIElementIsAttributeSettable(element, name as CFString, &flag) == .success && flag.boolValue
    }

    func walk(_ element: AXUIElement, depth: Int) {
      guard depth <= maxDepth, nodes.count < maxNodes else { return }
      let role = string(element, kAXRoleAttribute)
      let roleDescription = string(element, kAXRoleDescriptionAttribute)
      let title = string(element, kAXTitleAttribute)
      let description = string(element, kAXDescriptionAttribute)
      let identifier = string(element, kAXIdentifierAttribute)
      let url = (attribute(element, kAXURLAttribute) as? URL)?.absoluteString ?? ""
      var valueText = ""
      var valueIsNumber = false
      if let raw = attribute(element, kAXValueAttribute) {
        if let stringValue = raw as? String {
          valueText = stringValue
        } else if let number = raw as? NSNumber {
          valueText = Self.format(number)
          valueIsNumber = CFNumberIsFloatType(number)
        }
      }

      var states: [String] = []
      if let enabled = attribute(element, kAXEnabledAttribute) as? Bool, enabled == false {
        states.append("disabled")
      }
      if let selected = attribute(element, kAXSelectedAttribute) as? Bool {
        if selected {
          states.append("selected")
        } else if isSettable(element, kAXSelectedAttribute) {
          states.append("selectable")
        }
      } else if isSettable(element, kAXSelectedAttribute) {
        states.append("selectable")
      }
      if let expanded = attribute(element, kAXExpandedAttribute) as? Bool {
        states.append(expanded ? "expanded" : "collapsed")
      }
      if isSettable(element, kAXValueAttribute) {
        states.append("settable")
      }
      if valueIsNumber { states.append("float") }

      var actions: [String] = []
      var actionNames: CFArray?
      if AXUIElementCopyActionNames(element, &actionNames) == .success, let names = actionNames as? [String] {
        actions = names.filter { $0 != kAXPressAction as String }
      }

      let id = counter
      nodes.append(Node(id: id, role: role, roleDescription: roleDescription, title: title,
                        description: description, identifier: identifier, url: url,
                        value: valueText, valueIsNumber: valueIsNumber,
                        states: states, secondaryActions: actions, depth: depth))
      elements[id] = element
      counter += 1
      if let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
        for child in children { walk(child, depth: depth + 1) }
      }
    }

    walk(app, depth: 0)
    return Snapshot(nodes: nodes, elements: elements)
  }

  public static func frontWindowTitle(pid: pid_t) -> String {
    let app = AXUIElementCreateApplication(pid)
    var window: CFTypeRef?
    if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &window) == .success,
       let window {
      var title: CFTypeRef?
      if AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success,
         let text = title as? String, !text.isEmpty {
        return text
      }
    }
    return ""
  }

  public static func render(_ nodes: [Node], app: String = "", window: String = "") -> String {
    var lines: [String] = []
    if !window.isEmpty || !app.isEmpty {
      lines.append("Window: \"\(window)\", App: \(app).")
    }
    lines.append(contentsOf: nodes.map(line))
    return lines.joined(separator: "\n")
  }

  public static func line(_ node: Node) -> String {
    let indent = String(repeating: "\t", count: node.depth)
    var text = "\(indent)\(node.id) \(node.displayRole)"
    if !node.title.isEmpty { text += " \(node.title)" }
    if !node.states.isEmpty { text += " (\(node.states.joined(separator: ", ")))" }
    if !node.description.isEmpty { text += " Description: \(node.description)" }
    if !node.identifier.isEmpty { text += ", ID: \(node.identifier)" }
    if !node.url.isEmpty { text += ", URL: \(node.url)" }
    if !node.value.isEmpty {
      text += node.valueIsNumber ? " \(node.value)" : ", Value: \(node.value)"
    }
    if !node.secondaryActions.isEmpty {
      text += ", Secondary Actions: \(node.secondaryActions.joined(separator: ", "))"
    }
    return text
  }

  static func format(_ number: NSNumber) -> String {
    let double = number.doubleValue
    if double == double.rounded() { return String(Int(double)) }
    return String(double)
  }
}
