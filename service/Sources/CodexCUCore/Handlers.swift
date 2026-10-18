import AppKit
import ApplicationServices

public final class DefaultHandlers: ServiceHandlers {
  private let approvalsURL: URL?

  public init(approvalsURL: URL? = nil) {
    self.approvalsURL = approvalsURL
  }

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
    if let running = try? resolve(app) {
      running.activate(options: [])
      return ["app": app, "pid": Int(running.processIdentifier)]
    }
    guard let url = applicationURL(for: app) else {
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

  public func appState(_ app: String, disableDiff: Bool) throws -> [String: Any] {
    guard AXIsProcessTrusted() else {
      throw ServiceError(.permissionsNotGranted,
                         "accessibility permission is required to read \(app)")
    }
    let running = try resolve(app)
    let nodes = try AXTree.snapshot(pid: running.processIdentifier)
    return [
      "app": app,
      "text": AXTree.render(nodes),
      "skyshot": NSNull(), // screenshots are a later milestone; see docs/COMPATIBILITY.md
    ]
  }

  public func policy(_ app: String) throws -> [String: Any] {
    ["allowed": isAllowed(app)]
  }

  public func performAction(_ app: String, action: [String: Any]) throws -> [String: Any] {
    _ = try resolve(app)
    guard AXIsProcessTrusted() else {
      throw ServiceError(.permissionsNotGranted, "accessibility permission is required")
    }
    throw ServiceError(.unhandledEvent, "action not implemented yet: \(action.keys.first ?? "?")")
  }

  // MARK: - helpers

  private func resolve(_ app: String) throws -> NSRunningApplication {
    let matches = NSWorkspace.shared.runningApplications.filter { running in
      running.bundleIdentifier == app || running.localizedName == app
    }
    guard let running = matches.first else {
      throw ServiceError(.runningApplicationNotFound, "application not running: \(app)")
    }
    if matches.count > 1 { throw ServiceError(.ambiguousApp, "ambiguous application: \(app)") }
    return running
  }

  private func applicationURL(for app: String) -> URL? {
    if app.contains("."), let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: app) {
      return url
    }
    return NSWorkspace.shared.urlForApplication(withBundleIdentifier: app)
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
