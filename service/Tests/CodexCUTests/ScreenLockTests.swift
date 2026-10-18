import Testing
import Foundation
@testable import CodexCUCore

private func handlers(locked: Bool) -> DefaultHandlers {
  DefaultHandlers(
    store: SnapshotStore(),
    executor: FakeExecutor(),
    permissionsTrusted: { true },
    screenLocked: { locked },
    appExists: { _ in },
    pidForApp: { _ in 1 },
    snapshotProvider: { _ in AXTree.Snapshot(nodes: [], elements: [:]) },
    screenshotter: nil,
  )
}

@Test func observationFailsWhenTheScreenIsLocked() {
  do {
    _ = try handlers(locked: true).appState("com.test.app", disableDiff: false)
    Issue.record("expected screenLocked")
  } catch let error as ServiceError {
    #expect(error.code == .screenLocked)
  } catch {
    Issue.record("unexpected error: \(error)")
  }
}

@Test func actionsFailWhenTheScreenIsLocked() {
  do {
    _ = try handlers(locked: true).performAction("com.test.app", action: ["pressKey": ["_0": "return"]])
    Issue.record("expected screenLocked")
  } catch let error as ServiceError {
    #expect(error.code == .screenLocked)
  } catch {
    Issue.record("unexpected error: \(error)")
  }
}

@Test func unlockedScreensProceed() throws {
  let result = try handlers(locked: false).appState("com.test.app", disableDiff: false)
  #expect(result["app"] as? String == "com.test.app")
}
