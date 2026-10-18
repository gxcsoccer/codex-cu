import AppKit
import ApplicationServices

public final class DefaultHandlers: ServiceHandlers {
  private let approvalsURL: URL?
  private let store: SnapshotStore
  private let executor: ActionExecuting
  private let permissionsTrusted: () -> Bool
  private let appExists: (String) throws -> Void

  public init(approvalsURL: URL? = nil,
              store: SnapshotStore = SnapshotStore(),
              executor: ActionExecuting = SystemActionExecutor(),
              permissionsTrusted: @escaping () -> Bool = { AXIsProcessTrusted() },
              appExists: @escaping (String) throws -> Void = { app in _ = try DefaultHandlers.resolveRunning(app) }) {
    self.approvalsURL = approvalsURL
    self.store = store
    self.executor = executor
    self.permissionsTrusted = permissionsTrusted
    self.appExists = appExists
  }

  // MARK: - inventory / lifecycle

  public func listApps() throws -> [[String: Any]] {
    NSWorkspace.shared.runningApplications
      .filter { $0.activationPolicy == .regular }
      .compactMap { app in
        guard let bundle = app.bundleIdentifier else { return nil }
        return [
          "bundleIdentifier": bundle,
          "name": app.localizedName ?? bundle,
          "pid": Int(app.processIdentifier),
        ]
      }
      .sorted { ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "") }
  }

  public func startApp(_ app: String) throws -> [String: Any] {
    if let running = try? Self.resolveRunning(app) {
      running.activate(options: [])
      return ["app": app, "pid": Int(running.processIdentifier)]
    }
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: app) else {
      throw ServiceError(.runningApplicationNotFound, "application not found: \(app)")
    }
    let configuration = NSWorkspace.OpenConfiguration()
    var launchedPid: pid_t?
    let semaphore = DispatchSemaphore(value: 0)
    NSWorkspace.shared.openApplication(at: url, configuration: configuration) { running, _ in
      launchedPid = running?.processIdentifier
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 10)
    guard let pid = launchedPid else {
      throw ServiceError(.runningApplicationNotFound, "application did not launch: \(app)")
    }
    return ["app": app, "pid": Int(pid)]
  }

  // MARK: - observation

  public func appState(_ app: String, disableDiff: Bool) throws -> [String: Any] {
    guard permissionsTrusted() else {
      throw ServiceError(.permissionsNotGranted,
                         "accessibility permission is required to read \(app)")
    }
    let running = try Self.resolveRunning(app)
    let snapshot = try AXTree.snapshot(pid: running.processIdentifier)
    let revision = store.put(app: app, elements: snapshot.elements)
    return [
      "app": app,
      "text": AXTree.render(snapshot.nodes),
      "revision": revision,
      "skyshot": NSNull(), // screenshots are a later milestone; see docs/COMPATIBILITY.md
    ]
  }

  public func policy(_ app: String) throws -> [String: Any] {
    ["allowed": isAllowed(app)]
  }

  // MARK: - actions

  public func performAction(_ app: String, action: [String: Any]) throws -> [String: Any] {
    try appExists(app)
    guard isAllowed(app) else {
      throw ServiceError(.appNotAllowed, "application is not approved: \(app)")
    }
    guard permissionsTrusted() else {
      throw ServiceError(.permissionsNotGranted, "accessibility permission is required")
    }

    if let click = action["click"] as? [String: Any] {
      let target = try parseTarget(app: app, click["at"])
      let count = click["clickCount"] as? Int ?? 1
      let button = click["mouseButton"] as? Int ?? 0
      try executor.click(element: target.element, point: target.point, button: button, count: count)
    } else if let drag = action["drag"] as? [String: Any] {
      let from = try parsePoint(drag["from"])
      let to = try parsePoint(drag["to"])
      try executor.drag(from: from, to: to)
    } else if let scroll = action["scroll"] as? [String: Any] {
      let target = try parseTarget(app: app, scroll["at"])
      let direction = scroll["direction"] as? String ?? "down"
      let pages = scroll["pages"] as? Int ?? 1
      try executor.scroll(element: target.element, point: target.point, direction: direction, pages: pages)
    } else if let type = action["type"] as? [String: Any] {
      guard let text = type["_0"] as? String else {
        throw ServiceError(.couldNotGetRequestData, "type requires a string")
      }
      try executor.type(text)
    } else if let press = action["pressKey"] as? [String: Any] {
      guard let spec = press["_0"] as? String else {
        throw ServiceError(.couldNotGetRequestData, "pressKey requires a key string")
      }
      try executor.pressKey(spec)
    } else if let paste = action["paste"] as? [String: Any] {
      guard let text = paste["text"] as? String else {
        throw ServiceError(.couldNotGetRequestData, "paste requires text")
      }
      try executor.paste(text, format: paste["format"] as? String)
    } else if let setValue = action["setValue"] as? [String: Any] {
      let element = try resolveElement(app: app, id: setValue["elementID"])
      guard let value = setValue["value"] as? String else {
        throw ServiceError(.couldNotGetRequestData, "setValue requires a value")
      }
      try executor.setValue(element: element, value: value)
    } else if let select = action["selectText"] as? [String: Any] {
      let element = try resolveElement(app: app, id: select["elementID"])
      guard let text = select["text"] as? String else {
        throw ServiceError(.couldNotGetRequestData, "selectText requires text")
      }
      try executor.selectText(element: element, text: text)
    } else if let secondary = action["performSecondaryAction"] as? [String: Any] {
      let element = try resolveElement(app: app, id: secondary["elementID"])
      guard let name = secondary["action"] as? String else {
        throw ServiceError(.couldNotGetRequestData, "performSecondaryAction requires an action name")
      }
      try executor.secondaryAction(element: element, action: name)
    } else {
      throw ServiceError(.unhandledEvent, "unsupported action: \(action.keys.first ?? "?")")
    }

    store.invalidate(app: app)
    return ["ok": true]
  }

  // MARK: - parsing

  private struct Target {
    let element: AXUIElement?
    let point: CGPoint?
  }

  private func parseTarget(app: String, _ value: Any?) throws -> Target {
    guard let dictionary = value as? [String: Any] else {
      throw ServiceError(.couldNotGetRequestData, "action target is missing")
    }
    if let elementID = dictionary["elementID"] {
      let id = try parseInt(elementID)
      let element = try resolveElement(app: app, id: id)
      return Target(element: element, point: nil)
    }
    if let coordinate = dictionary["coordinate"] {
      return Target(element: nil, point: try parsePoint(coordinate))
    }
    throw ServiceError(.couldNotGetRequestData, "action target must be elementID or coordinate")
  }

  private func resolveElement(app: String, id: Any?) throws -> AXUIElement {
    guard let id else { throw ServiceError(.couldNotGetRequestData, "elementID is required") }
    return try store.resolve(app: app, elementID: try parseInt(id))
  }

  private func parseInt(_ value: Any) throws -> Int {
    if let dictionary = value as? [String: Any], let inner = dictionary["_0"] {
      return try parseInt(inner)
    }
    if let string = value as? String, let number = Int(string) { return number }
    if let number = value as? Int { return number }
    if let number = value as? NSNumber { return number.intValue }
    throw ServiceError(.couldNotGetRequestData, "elementID must be a string or integer")
  }

  private func parsePoint(_ value: Any?) throws -> CGPoint {
    let raw: Any?
    if let dictionary = value as? [String: Any] {
      raw = dictionary["_0"]
    } else {
      raw = value
    }
    guard let array = raw as? [Any], array.count == 2,
          let x = doubleValue(array[0]), let y = doubleValue(array[1]) else {
      throw ServiceError(.couldNotGetRequestData, "coordinate must be [x, y]")
    }
    return CGPoint(x: x, y: y)
  }

  private func doubleValue(_ value: Any) -> Double? {
    if let number = value as? NSNumber { return number.doubleValue }
    if let number = value as? Double { return number }
    if let number = value as? Int { return Double(number) }
    return nil
  }

  // MARK: - helpers

  public static func resolveRunning(_ app: String) throws -> NSRunningApplication {
    let matches = NSWorkspace.shared.runningApplications.filter { running in
      running.bundleIdentifier == app || running.localizedName == app
    }
    guard let running = matches.first else {
      throw ServiceError(.runningApplicationNotFound, "application not running: \(app)")
    }
    if matches.count > 1 { throw ServiceError(.ambiguousApp, "ambiguous application: \(app)") }
    return running
  }

  private func isAllowed(_ app: String) -> Bool {
    guard let url = approvalsURL,
          let data = try? Data(contentsOf: url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let apps = json["apps"] as? [String: Any] else {
      return true // no approval store configured: allow (documented in COMPATIBILITY.md)
    }
    return (apps[app] as? [String: Any])?["allowed"] as? Bool ?? true
  }
}
