import ApplicationServices
import Foundation

/// Holds the last observation per app so `elementID`s can be resolved.
/// IDs are only valid for the observation that produced them; using an ID from
/// an older snapshot raises `accessibilityError`, matching the original's
/// "fresh refs" rule.
public final class SnapshotStore {
  public struct Entry {
    public let elements: [Int: AXUIElement]
    public let revision: Int
  }

  private var entries: [String: Entry] = [:]
  private var revisions: [String: Int] = [:]
  private let lock = NSLock()

  public init() {}

  public func put(app: String, elements: [Int: AXUIElement]) -> Int {
    lock.lock()
    defer { lock.unlock() }
    let revision = (revisions[app] ?? 0) + 1
    revisions[app] = revision
    entries[app] = Entry(elements: elements, revision: revision)
    return revision
  }

  public func revision(for app: String) -> Int {
    lock.lock()
    defer { lock.unlock() }
    return revisions[app] ?? 0
  }

  public func resolve(app: String, elementID: Int) throws -> AXUIElement {
    lock.lock()
    defer { lock.unlock() }
    guard let entry = entries[app] else {
      throw ServiceError(.accessibilityError, "no observation for \(app); call getAppState first")
    }
    guard let element = entry.elements[elementID] else {
      throw ServiceError(.accessibilityError,
                         "stale or unknown elementID \(elementID) for \(app) (revision \(entry.revision))")
    }
    return element
  }

  /// Called after an action mutates the UI, so previously-issued IDs stop resolving.
  public func invalidate(app: String) {
    lock.lock()
    defer { lock.unlock() }
    entries[app] = nil
  }
}
