import ApplicationServices
import Testing
import Foundation
@testable import CodexCUCore

private func node(id: Int, title: String) -> AXTree.Node {
  AXTree.Node(id: id, role: "AXButton", roleDescription: "button", title: title,
              description: "", identifier: "save-\(title)", url: "", value: "",
              valueIsNumber: false, states: [], secondaryActions: [], depth: 0)
}

private func snapshot(ids: [Int]) -> AXTree.Snapshot {
  let nodes = ids.map { node(id: $0, title: "Save") }
  let element = AXUIElementCreateSystemWide()
  return AXTree.Snapshot(nodes: nodes, elements: Dictionary(uniqueKeysWithValues: ids.map { ($0, element) }))
}

@Test func staleIDsAreRefetchedByCriteria() throws {
  var snapshots = [snapshot(ids: [7]), snapshot(ids: [9])]
  let executor = FakeExecutor()
  let handlers = DefaultHandlers(
    store: SnapshotStore(),
    executor: executor,
    permissionsTrusted: { true },
    screenLocked: { false },
    appExists: { _ in },
    pidForApp: { _ in 1 },
    snapshotProvider: { _ in snapshots.removeFirst() },
    screenshotter: nil,
  )
  _ = try handlers.appState("com.test.app", disableDiff: true)
  _ = try handlers.performAction("com.test.app", action: ["click": ["at": ["elementID": ["_0": "7"]]]])
  // The ID is stale now; refetch finds the same criteria at id 9.
  _ = try handlers.performAction("com.test.app", action: ["click": ["at": ["elementID": ["_0": "7"]]]])
  #expect(executor.calls.count == 2)
}

@Test func refetchAmbiguityAndMissProduceObservedMessages() throws {
  var snapshots = [snapshot(ids: [7]), snapshot(ids: [9, 10])]
  let handlers = DefaultHandlers(
    store: SnapshotStore(),
    executor: FakeExecutor(),
    permissionsTrusted: { true },
    screenLocked: { false },
    appExists: { _ in },
    pidForApp: { _ in 1 },
    snapshotProvider: { _ in snapshots.removeFirst() },
    screenshotter: nil,
  )
  _ = try handlers.appState("com.test.app", disableDiff: true)
  _ = try handlers.performAction("com.test.app", action: ["click": ["at": ["elementID": ["_0": "7"]]]])
  do {
    _ = try handlers.performAction("com.test.app", action: ["click": ["at": ["elementID": ["_0": "7"]]]])
    Issue.record("expected ambiguity")
  } catch let error as ServiceError {
    #expect(error.code == .accessibilityError)
    #expect(error.message.contains("multiple elements"))
  }

  var empty = [snapshot(ids: [7]), snapshot(ids: [])]
  let missing = DefaultHandlers(
    store: SnapshotStore(),
    executor: FakeExecutor(),
    permissionsTrusted: { true },
    screenLocked: { false },
    appExists: { _ in },
    pidForApp: { _ in 1 },
    snapshotProvider: { _ in empty.removeFirst() },
    screenshotter: nil,
  )
  _ = try missing.appState("com.test.app", disableDiff: true)
  _ = try missing.performAction("com.test.app", action: ["click": ["at": ["elementID": ["_0": "7"]]]])
  do {
    _ = try missing.performAction("com.test.app", action: ["click": ["at": ["elementID": ["_0": "7"]]]])
    Issue.record("expected miss")
  } catch let error as ServiceError {
    #expect(error.message.contains("no longer valid"))
  }
}
