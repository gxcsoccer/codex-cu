import AppKit
import ApplicationServices
import CoreGraphics

public protocol ActionExecuting {
  func click(element: AXUIElement?, point: CGPoint?, button: Int, count: Int, modifiers: CGEventFlags, duration: TimeInterval) throws
  func drag(from: CGPoint, to: CGPoint) throws
  func scroll(element: AXUIElement?, point: CGPoint?, direction: String, pages: Int) throws
  func type(_ text: String) throws
  func pressKey(_ spec: String, duration: TimeInterval) throws
  func paste(_ text: String, format: String?) throws
  func setValue(element: AXUIElement, value: String) throws
  func selectText(element: AXUIElement, text: String, prefix: String?, suffix: String?) throws
  func secondaryAction(element: AXUIElement, action: String) throws
}

/// AX-first, CGEvent fallback. Every synthetic event path requires the
/// Accessibility permission, exactly like the original service.
public final class SystemActionExecutor: ActionExecuting {
  public init() {}

  public func click(element: AXUIElement?, point: CGPoint?, button: Int, count: Int,
                    modifiers: CGEventFlags = [], duration: TimeInterval = 0) throws {
    if modifiers.isEmpty, duration == 0, let element, try pressIfPossible(element) { return }
    let target = point ?? element.flatMap(Self.center(of:))
    guard let target else {
      throw ServiceError(.accessibilityError, "click needs a resolvable element or a coordinate")
    }
    try requireAccessibility()
    let (down, up) = button == 1
      ? (CGEventType.rightMouseDown, CGEventType.rightMouseUp)
      : (CGEventType.leftMouseDown, CGEventType.leftMouseUp)
    let mouseButton: CGMouseButton = button == 1 ? .right : (button == 2 ? .center : .left)
    let source = CGEventSource(stateID: .hidSystemState)
    for _ in 0..<max(1, count) {
      for type in [down, up] {
        guard let event = CGEvent(mouseEventSource: source, mouseType: type,
                                  mouseCursorPosition: target, mouseButton: mouseButton) else { continue }
        event.setIntegerValueField(.mouseEventClickState, value: Int64(max(1, count)))
        event.flags = modifiers
        event.post(tap: .cghidEventTap)
        if duration > 0, type == down { Thread.sleep(forTimeInterval: duration) }
      }
    }
  }

  public func drag(from: CGPoint, to: CGPoint) throws {
    try requireAccessibility()
    let source = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)?
      .post(tap: .cghidEventTap)
    let steps = 12
    for index in 1...steps {
      let t = CGFloat(index) / CGFloat(steps)
      let point = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
      CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
      usleep(8_000)
    }
    CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)?
      .post(tap: .cghidEventTap)
  }

  public func scroll(element: AXUIElement?, point: CGPoint?, direction: String, pages: Int) throws {
    try requireAccessibility()
    let amount: Int32 = Int32(max(1, pages) * 400)
    let delta: Int32
    switch direction {
    case "down": delta = -amount
    case "up": delta = amount
    case "left": delta = amount
    case "right": delta = -amount
    default: throw ServiceError(.couldNotGetRequestData, "unknown scroll direction: \(direction)")
    }
    guard let event = CGEvent(scrollWheelEvent2Source: CGEventSource(stateID: .hidSystemState),
                              units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0) else {
      throw ServiceError(.unknownError, "could not create scroll event")
    }
    if let target = point ?? element.flatMap(Self.center(of:)) { event.location = target }
    event.post(tap: .cghidEventTap)
  }

  public func type(_ text: String) throws {
    try requireAccessibility()
    let source = CGEventSource(stateID: .hidSystemState)
    let units = Array(text.utf16)
    var index = 0
    while index < units.count {
      let end = min(index + 16, units.count)
      let slice = Array(units[index..<end])
      guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true) else {
        throw ServiceError(.unknownError, "could not create key event")
      }
      event.keyboardSetUnicodeString(stringLength: slice.count, unicodeString: slice)
      event.post(tap: .cghidEventTap)
      CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)?
        .post(tap: .cghidEventTap)
      index = end
    }
  }

  public func pressKey(_ spec: String, duration: TimeInterval = 0) throws {
    try requireAccessibility()
    let chord = try KeyCodes.parse(spec)
    let source = CGEventSource(stateID: .hidSystemState)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: chord.key, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: chord.key, keyDown: false) else {
      throw ServiceError(.unknownError, "could not create key event")
    }
    down.flags = chord.flags
    up.flags = chord.flags
    down.post(tap: .cghidEventTap)
    if duration > 0 { Thread.sleep(forTimeInterval: duration) }
    up.post(tap: .cghidEventTap)
  }

  public func paste(_ text: String, format: String?) throws {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
    try pressKey("cmd+v")
  }

  public func setValue(element: AXUIElement, value: String) throws {
    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
    guard result == .success else {
      throw ServiceError(.accessibilityError, "could not set AXValue (AXError \(result.rawValue))")
    }
  }

  public func selectText(element: AXUIElement, text: String, prefix: String? = nil, suffix: String? = nil) throws {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value) == .success,
          let string = value as? String else {
      throw ServiceError(.accessibilityError, "element has no string value for selectText")
    }
    let ns = string as NSString
    var search = NSRange(location: 0, length: ns.length)
    var match: NSRange?
    while search.length > 0 {
      let candidate = ns.range(of: text, options: [], range: search)
      if candidate.location == NSNotFound { break }
      var ok = true
      if let prefix, !prefix.isEmpty {
        let start = candidate.location - prefix.utf16.count
        if start < 0 || ns.substring(with: NSRange(location: start, length: prefix.utf16.count)) != prefix { ok = false }
      }
      if ok, let suffix, !suffix.isEmpty {
        let end = candidate.location + candidate.length
        if end + suffix.utf16.count > ns.length
          || ns.substring(with: NSRange(location: end, length: suffix.utf16.count)) != suffix { ok = false }
      }
      if ok { match = candidate; break }
      let next = candidate.location + max(1, candidate.length)
      search = NSRange(location: next, length: ns.length - next)
    }
    guard let range = match else {
      throw ServiceError(.accessibilityError, "text not found for selectText (prefix/suffix did not match)")
    }
    var cfRange = CFRange(location: range.location, length: range.length)
    guard let axRange = AXValueCreate(.cfRange, &cfRange) else {
      throw ServiceError(.unknownError, "could not create AX range")
    }
    let result = AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, axRange)
    guard result == .success else {
      throw ServiceError(.accessibilityError, "could not set AXSelectedTextRange (AXError \(result.rawValue))")
    }
  }

  public func secondaryAction(element: AXUIElement, action: String) throws {
    let result = AXUIElementPerformAction(element, action as CFString)
    guard result == .success else {
      throw ServiceError(.accessibilityError, "action \(action) failed (AXError \(result.rawValue))")
    }
  }

  // MARK: - helpers

  private func requireAccessibility() throws {
    guard AXIsProcessTrusted() else {
      throw ServiceError(.permissionsNotGranted, "accessibility permission is required")
    }
  }

  private func pressIfPossible(_ element: AXUIElement) throws -> Bool {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success,
          let actions = names as? [String], actions.contains(kAXPressAction as String) else {
      return false
    }
    return AXUIElementPerformAction(element, kAXPressAction as CFString) == .success
  }

  public static func center(of element: AXUIElement) -> CGPoint? {
    guard let frame = frame(of: element) else { return nil }
    return CGPoint(x: frame.midX, y: frame.midY)
  }

  public static func frame(of element: AXUIElement) -> CGRect? {
    func attribute(_ name: String) -> CFTypeRef? {
      var value: CFTypeRef?
      guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
      return value
    }
    guard let positionValue = attribute(kAXPositionAttribute),
          let sizeValue = attribute(kAXSizeAttribute) else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &point),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
  }
}
