import Testing
import Foundation
@testable import CodexCUCore

private func writeApprovals(_ json: String) throws -> URL {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  let url = directory.appendingPathComponent("approvals.json")
  try json.write(to: url, atomically: true, encoding: .utf8)
  return url
}

private func handlers(approvals: URL?) -> DefaultHandlers {
  DefaultHandlers(
    approvalsURL: approvals,
    store: SnapshotStore(),
    executor: FakeExecutor(),
    permissionsTrusted: { true },
    screenLocked: { false },
    appExists: { _ in },
    pidForApp: { _ in 1 },
    snapshotProvider: { _ in AXTree.Snapshot(nodes: [], elements: [:]) },
    screenshotter: nil,
  )
}

@Test func ambiguousAppSelectionIsRejected() {
  do {
    _ = try DefaultHandlers.selectRunning([1, 2], app: "x")
    Issue.record("expected ambiguousApp")
  } catch let error as ServiceError {
    #expect(error.code == .ambiguousApp)
  } catch { Issue.record("unexpected: \(error)") }
}

@Test func missingAppSelectionIsRejected() {
  do {
    _ = try DefaultHandlers.selectRunning([Int](), app: "x")
    Issue.record("expected runningApplicationNotFound")
  } catch let error as ServiceError {
    #expect(error.code == .runningApplicationNotFound)
  } catch { Issue.record("unexpected: \(error)") }
}

@Test func aSingleMatchIsReturned() throws {
  #expect(try DefaultHandlers.selectRunning(["only"], app: "x") == "only")
}

@Test func explicitDenialReturnsAppNotAllowed() throws {
  let url = try writeApprovals(#"{"apps":{"com.test.app":{"allowed":false}}}"#)
  defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
  let policy = try handlers(approvals: url).policy("com.test.app")
  #expect(policy["allowed"] as? Bool == false)
  do {
    _ = try handlers(approvals: url).performAction("com.test.app", action: ["pressKey": ["_0": "return"]])
    Issue.record("expected appNotAllowed")
  } catch let error as ServiceError {
    #expect(error.code == .appNotAllowed)
  }
}

@Test func missingOrMalformedApprovalsFailOpen() throws {
  #expect(try handlers(approvals: nil).policy("com.test.app")["allowed"] as? Bool == true)

  let malformed = try writeApprovals("not-json")
  defer { try? FileManager.default.removeItem(at: malformed.deletingLastPathComponent()) }
  #expect(try handlers(approvals: malformed).policy("com.test.app")["allowed"] as? Bool == true)

  let otherApp = try writeApprovals(#"{"apps":{"com.other.app":{"allowed":false}}}"#)
  defer { try? FileManager.default.removeItem(at: otherApp.deletingLastPathComponent()) }
  #expect(try handlers(approvals: otherApp).policy("com.test.app")["allowed"] as? Bool == true)
}

@Test func instructionsFileIsLoadedAndRejectsMalformedJSON() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }

  let valid = directory.appendingPathComponent("valid.json")
  try #"{"apps":{"com.test.app":"Use the sidebar."}}"#.write(to: valid, atomically: true, encoding: .utf8)
  #expect(try DefaultHandlers.loadInstructions(at: valid) == ["com.test.app": "Use the sidebar."])

  let invalid = directory.appendingPathComponent("invalid.json")
  try "[]".write(to: invalid, atomically: true, encoding: .utf8)
  #expect(throws: ServiceError.self) { _ = try DefaultHandlers.loadInstructions(at: invalid) }

  let missing = directory.appendingPathComponent("missing.json")
  #expect(throws: ServiceError.self) { _ = try DefaultHandlers.loadInstructions(at: missing) }
}
