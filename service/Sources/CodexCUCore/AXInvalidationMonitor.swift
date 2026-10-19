import ApplicationServices
import Foundation

/// Watches an application's accessibility notifications and debounces them into
/// an invalidation callback. The original keeps a `RefetchableSkyshotAXTree`
/// alive with an invalidation monitor; this is the equivalent signal so stale
/// element ids are refetched even when the change came from another process.
public final class AXInvalidationMonitor {
  private final class Context {
    let app: String
    let onInvalidate: () -> Void
    private let queue = DispatchQueue(label: "codex-cu.ax-invalidation")
    private var pending: DispatchWorkItem?

    init(app: String, onInvalidate: @escaping () -> Void) {
      self.app = app
      self.onInvalidate = onInvalidate
    }

    func fire() {
      queue.async { [weak self] in
        guard let self else { return }
        self.pending?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.onInvalidate() }
        self.pending = item
        self.queue.asyncAfter(deadline: .now() + 0.05, execute: item)
      }
    }
  }

  private struct Entry {
    let observer: AXObserver?
    let source: CFRunLoopSource?
    let context: Context
  }

  private static let notifications: [String] = [
    kAXValueChangedNotification as String,
    kAXUIElementDestroyedNotification as String,
    kAXFocusedUIElementChangedNotification as String,
    kAXWindowCreatedNotification as String,
    kAXWindowMovedNotification as String,
    kAXWindowResizedNotification as String,
  ]

  private let lock = NSLock()
  private var entries: [String: Entry] = [:]
  private var runLoop: CFRunLoop?
  private var thread: Thread?

  public init() {}

  /// Replaces any previous watcher for `app`. Safe to call on every observation.
  public func watch(app: String, pid: pid_t, onInvalidate: @escaping () -> Void) {
    stop(app: app)
    let context = Context(app: app, onInvalidate: onInvalidate)
    var observer: AXObserver?
    let created = AXObserverCreate(pid, Self.callback, &observer)
    var source: CFRunLoopSource?
    if created == .success, let observer, let loop = ensureRunLoop() {
      let element = AXUIElementCreateApplication(pid)
      let refcon = Unmanaged.passUnretained(context).toOpaque()
      for notification in Self.notifications {
        AXObserverAddNotification(observer, element, notification as CFString, refcon)
      }
      source = AXObserverGetRunLoopSource(observer)
      if let source { CFRunLoopAddSource(loop, source, .defaultMode) }
    }
    lock.lock()
    entries[app] = Entry(observer: observer, source: source, context: context)
    lock.unlock()
  }

  public func stop(app: String) {
    lock.lock()
    let entry = entries.removeValue(forKey: app)
    let loop = runLoop
    lock.unlock()
    guard let entry else { return }
    if let source = entry.source, let loop { CFRunLoopRemoveSource(loop, source, .defaultMode) }
  }

  public func stopAll() {
    lock.lock()
    let apps = Array(entries.keys)
    lock.unlock()
    for app in apps { stop(app: app) }
  }

  deinit { stopAll() }

  /// Test hook: drives the same debounced path without a notification.
  func notifyForTesting(_ app: String) {
    lock.lock()
    let context = entries[app]?.context
    lock.unlock()
    context?.fire()
  }

  public func isWatching(_ app: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return entries[app] != nil
  }

  private func ensureRunLoop() -> CFRunLoop? {
    lock.lock()
    if let runLoop {
      lock.unlock()
      return runLoop
    }
    lock.unlock()
    let semaphore = DispatchSemaphore(value: 0)
    let thread = Thread { [weak self] in
      let loop = CFRunLoopGetCurrent()
      self?.lock.lock()
      self?.runLoop = loop
      self?.lock.unlock()
      semaphore.signal()
      CFRunLoopRun()
    }
    thread.name = "codex-cu.ax-observer"
    thread.start()
    semaphore.wait()
    lock.lock()
    self.thread = thread
    let loop = runLoop
    lock.unlock()
    return loop
  }

  private static let callback: AXObserverCallback = { _, _, _, refcon in
    guard let refcon else { return }
    let context = Unmanaged<Context>.fromOpaque(refcon).takeUnretainedValue()
    context.fire()
  }
}
