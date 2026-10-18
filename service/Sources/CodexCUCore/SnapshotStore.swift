import ApplicationServices
import Foundation

/// Holds the last observation per app: element IDs, the rendered nodes (for
/// diffing) and the last screenshot. IDs are valid only for the observation that
/// produced them; using an ID from an older snapshot raises `accessibilityError`.
public final class SnapshotStore {
  public struct Entry {
    public let elements: [Int: AXUIElement]
    public let nodes: [AXTree.Node]
    public let revision: Int
    public let screenshotURL: URL?
  }

  private var entries: [String: Entry] = [:]
  private var revisions: [String: Int] = [:]
  private let lock = NSLock()

  public init() {}

  @discardableResult
  public func put(app: String,
                  elements: [Int: AXUIElement],
                  nodes: [AXTree.Node] = [],
                  screenshotURL: URL? = nil) -> Int {
    lock.lock()
    defer { lock.unlock() }
    let revision = (revisions[app] ?? 0) + 1
    revisions[app] = revision
    entries[app] = Entry(elements: elements, nodes: nodes, revision: revision, screenshotURL: screenshotURL)
    return revision
  }

  public func revision(for app: String) -> Int {
    lock.lock()
    defer { lock.unlock() }
    return revisions[app] ?? 0
  }

  public func nodes(for app: String) -> [AXTree.Node]? {
    lock.lock()
    defer { lock.unlock() }
    return entries[app]?.nodes
  }

  public func screenshotURL(for app: String) -> URL? {
    lock.lock()
    defer { lock.unlock() }
    return entries[app]?.screenshotURL
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

  /// Invalidates element IDs after an action while keeping the last nodes and
  /// screenshot so the next observation can still produce a diff.
  public func invalidate(app: String) {
    lock.lock()
    defer { lock.unlock() }
    guard let entry = entries[app] else { return }
    entries[app] = Entry(elements: [:], nodes: entry.nodes, revision: entry.revision,
                         screenshotURL: entry.screenshotURL)
  }
}
