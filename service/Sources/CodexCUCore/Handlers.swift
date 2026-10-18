import AppKit
import ApplicationServices

public final class DefaultHandlers: ServiceHandlers {
  private let approvalsURL: URL?
  private let store: SnapshotStore
  private let executor: ActionExecuting
  private let permissionsTrusted: () -> Bool
  private let screenLocked: () -> Bool
  private let appExists: (String) throws -> Void
  private let pidForApp: (String) throws -> pid_t
  private let openApplication: (String) throws -> pid_t
  private let windowCount: (pid_t) -> Int
  private let wait: (TimeInterval) -> Void
  private let launchTimeout: TimeInterval
  private let snapshotProvider: (pid_t) throws -> AXTree.Snapshot
  private let screenshotter: ScreenshotCapturing?
  private let screenshotStore: ScreenshotStore
  private let instructions: [String: String]
  private let audioRecorder: AudioRecording?
  private var audioActive = false
  private var lastAudioURL: URL?
  private var audioTimer: DispatchSourceTimer?
  private let audioLock = NSLock()

  public init(approvalsURL: URL? = nil,
              store: SnapshotStore = SnapshotStore(),
              executor: ActionExecuting = SystemActionExecutor(),
              permissionsTrusted: @escaping () -> Bool = { AXIsProcessTrusted() },
              screenLocked: @escaping () -> Bool = { ScreenLock.isLocked() },
              appExists: @escaping (String) throws -> Void = { app in _ = try DefaultHandlers.resolveRunning(app) },
              pidForApp: @escaping (String) throws -> pid_t = { try DefaultHandlers.resolveRunning($0).processIdentifier },
              openApplication: @escaping (String) throws -> pid_t = { try DefaultHandlers.openApplication($0) },
              windowCount: @escaping (pid_t) -> Int = { AXTree.windowCount(pid: $0) },
              wait: @escaping (TimeInterval) -> Void = { Thread.sleep(forTimeInterval: $0) },
              launchTimeout: TimeInterval = 5,
              snapshotProvider: @escaping (pid_t) throws -> AXTree.Snapshot = { try AXTree.snapshot(pid: $0) },
              screenshotter: ScreenshotCapturing? = SystemScreenshotCapturer(),
              screenshotStore: ScreenshotStore = ScreenshotStore(),
              instructions: [String: String] = [:],
              audioRecorder: AudioRecording? = nil) {
    self.approvalsURL = approvalsURL
    self.store = store
    self.executor = executor
    self.permissionsTrusted = permissionsTrusted
    self.screenLocked = screenLocked
    self.appExists = appExists
    self.pidForApp = pidForApp
    self.openApplication = openApplication
    self.windowCount = windowCount
    self.wait = wait
    self.launchTimeout = launchTimeout
    self.snapshotProvider = snapshotProvider
    self.screenshotter = screenshotter
    self.screenshotStore = screenshotStore
    self.instructions = instructions
    self.audioRecorder = audioRecorder
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
      waitForWindow(pid: running.processIdentifier)
      return ["app": app, "pid": Int(running.processIdentifier)]
    }
    let pid = try openApplication(app)
    waitForWindow(pid: pid)
    return ["app": app, "pid": Int(pid)]
  }

  /// Best-effort: an app that is launched but has no window yet is a common
  /// source of first-action failures, so wait briefly for one. Without the
  /// Accessibility permission there is nothing to inspect and we return at once.
  private func waitForWindow(pid: pid_t) {
    guard permissionsTrusted() else { return }
    let attempts = max(1, Int((launchTimeout / 0.1).rounded(.up)))
    for _ in 0..<attempts {
      if windowCount(pid) > 0 { return }
      wait(0.1)
    }
  }

  public static func openApplication(_ app: String) throws -> pid_t {
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
    return pid
  }

  // MARK: - observation

  public func appState(_ app: String, disableDiff: Bool) throws -> [String: Any] {
    guard !screenLocked() else {
      throw ServiceError(.screenLocked, "the screen is locked")
    }
    guard permissionsTrusted() else {
      throw ServiceError(.permissionsNotGranted,
                         "accessibility permission is required to read \(app)")
    }
    let pid = try pidForApp(app)
    let snapshot = try snapshotProvider(pid)
    let previous = store.nodes(for: app)
    let appName = NSRunningApplication(processIdentifier: pid)?.localizedName ?? app
    let windowTitle = AXTree.frontWindowTitle(pid: pid)

    var skyshot: Any = NSNull()
    var screenshotURL: URL?
    if let screenshotter {
      let data = try screenshotter.capture(pid: pid)
      screenshotURL = try screenshotStore.write(data, app: app)
      skyshot = ["screenshot": ["url": screenshotURL!.absoluteString, "mimeType": "image/png"]]
    }

    let text = (!disableDiff
      ? previous.map { AXDiff.render(previous: $0, current: snapshot.nodes, app: appName, window: windowTitle) }
      : nil)
      ?? AXTree.render(snapshot.nodes, app: appName, window: windowTitle)
    let previousScreenshotURL = store.screenshotURL(for: app)
    let revision = store.put(app: app, elements: snapshot.elements, nodes: snapshot.nodes, screenshotURL: screenshotURL)
    screenshotStore.remove(previousScreenshotURL)

    var result: [String: Any] = [
      "app": app,
      "text": text,
      "revision": revision,
      "skyshot": skyshot,
    ]
    if let appInstructions = instructions[app] ?? AppInstructions.text(for: app) {
      result["appSpecificInstructions"] = appInstructions
    }
    return result
  }

  public func policy(_ app: String) throws -> [String: Any] {
    let decision = approvalDecision(app)
    return ["allowed": decision.allowed, "decision": decision.decision]
  }

  // MARK: - actions

  // MARK: - audio

  public func startAudioRecording(_ request: [String: Any]) throws -> [String: Any] {
    guard let audioRecorder else {
      throw ServiceError(.unhandledEvent, "audio recording is not implemented")
    }
    let duration = try AudioLimits.validate(request["maxDurationMilliseconds"])
    audioLock.lock()
    defer { audioLock.unlock() }
    guard !audioActive else {
      throw ServiceError(.unhandledEvent, "audio recording is already active")
    }
    try audioRecorder.start()
    audioActive = true
    lastAudioURL = nil
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now() + .milliseconds(duration))
    timer.setEventHandler { [weak self] in _ = try? self?.finishAudioRecording() }
    timer.resume()
    audioTimer = timer
    return [:]
  }

  public func stopAudioRecording() throws -> [String: Any] {
    guard audioRecorder != nil else {
      throw ServiceError(.unhandledEvent, "audio recording is not implemented")
    }
    if let url = try finishAudioRecording() {
      return ["url": url.absoluteString]
    }
    audioLock.lock()
    let previous = lastAudioURL
    audioLock.unlock()
    guard let previous else {
      throw ServiceError(.unhandledEvent, "audio recording is not active")
    }
    // A late stop after the auto-stop timer still returns the finished file.
    return ["url": previous.absoluteString]
  }

  @discardableResult
  private func finishAudioRecording() throws -> URL? {
    audioLock.lock()
    guard audioActive, let audioRecorder else {
      audioLock.unlock()
      return nil
    }
    audioActive = false
    audioTimer?.cancel()
    audioTimer = nil
    audioLock.unlock()

    let url = try audioRecorder.stop()
    audioLock.lock()
    lastAudioURL = url
    audioLock.unlock()
    return url
  }

  public func performAction(_ app: String, action: [String: Any]) throws -> [String: Any] {
    guard !screenLocked() else {
      throw ServiceError(.screenLocked, "the screen is locked")
    }
    try appExists(app)
    guard approvalDecision(app).allowed else {
      throw ServiceError(.appNotAllowed, "application is not approved: \(app)")
    }
    guard permissionsTrusted() else {
      throw ServiceError(.permissionsNotGranted, "accessibility permission is required")
    }

    if let click = action["click"] as? [String: Any] {
      let target = try parseTarget(app: app, click["at"])
      let count = click["clickCount"] as? Int ?? 1
      let button = click["mouseButton"] as? Int ?? 0
      let modifiers = try (click["key"] as? String).map { try KeyCodes.parseModifiers($0) } ?? []
      let duration = click["duration"] as? Double ?? 0
      try executor.click(element: target.element, point: target.point, button: button, count: count,
                         modifiers: modifiers, duration: duration)
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
      try executor.pressKey(spec, duration: press["duration"] as? Double ?? 0)
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
      try executor.selectText(element: element, text: text,
                             prefix: select["prefix"] as? String, suffix: select["suffix"] as? String)
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
    return try selectRunning(matches, app: app)
  }

  /// Loads `{"apps": {"<bundle>": "<text>"}}`; malformed files are a request error.
  public static func loadInstructions(at url: URL) throws -> [String: String] {
    do {
      let data = try Data(contentsOf: url)
      guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let apps = json["apps"] as? [String: String] else {
        throw ServiceError(.couldNotGetRequestData, "instructions file needs {\"apps\": {bundle: text}}")
      }
      return apps
    } catch let error as ServiceError {
      throw error
    } catch {
      throw ServiceError(.couldNotGetRequestData, "could not read instructions: \(error.localizedDescription)")
    }
  }

  /// Pure selection rule: no match -> not found, more than one -> ambiguous.
  public static func selectRunning<T>(_ matches: [T], app: String) throws -> T {
    guard let first = matches.first else {
      throw ServiceError(.runningApplicationNotFound, "application not running: \(app)")
    }
    if matches.count > 1 {
      throw ServiceError(.ambiguousApp, "ambiguous application: \(app)")
    }
    return first
  }

  private struct ApprovalDecision {
    let allowed: Bool
    let decision: String
  }

  private static let allowDecision = ApprovalDecision(allowed: true, decision: "alwaysAllow")
  private static let denyDecision = ApprovalDecision(allowed: false, decision: "alwaysDeny")

  /// The observed store has `persistentApprovals` (bundleID -> alwaysAllow /
  /// alwaysDeny) and `allowAllChats`. The older `{apps: {id: {allowed}}}`
  /// document is still accepted so existing deployments do not break.
  private func approvalDecision(_ app: String) -> ApprovalDecision {
    guard let url = approvalsURL,
          let data = try? Data(contentsOf: url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return Self.allowDecision // no store: allow (documented deviation)
    }
    if (json["allowAllChats"] as? Bool) == true { return Self.allowDecision }

    if let persistent = json["persistentApprovals"] as? [String: Any] {
      // string form: {"id": "alwaysDeny"}
      if let raw = persistent[app] as? String {
        if raw == "alwaysDeny" { return Self.denyDecision }
        if raw == "alwaysAllow" { return Self.allowDecision }
      }
      // struct form: {"id": {"displayName": "...", "decision": "alwaysDeny"}}
      if let entry = persistent[app] as? [String: Any], let raw = entry["decision"] as? String {
        if raw == "alwaysDeny" { return Self.denyDecision }
        if raw == "alwaysAllow" { return Self.allowDecision }
      }
    }
    if let apps = json["apps"] as? [String: Any] {
      if let entry = apps[app] as? [String: Any], let allowed = entry["allowed"] as? Bool {
        return allowed ? Self.allowDecision : Self.denyDecision
      }
      if let raw = apps[app] as? String {
        return raw == "alwaysDeny" ? Self.denyDecision : Self.allowDecision
      }
    }
    return Self.allowDecision
  }
}
