import Testing
import Foundation
import ApplicationServices
@testable import CodexCUCore

final class FakeScreenshotter: ScreenshotCapturing {
  var data = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  var error: Error?
  var capturedPids: [pid_t] = []
  func capture(pid: pid_t) throws -> Data {
    capturedPids.append(pid)
    if let error { throw error }
    return data
  }
}

private func nodes(_ specs: [(Int, String, String)]) -> [AXTree.Node] {
  specs.map { AXTree.Node(id: $0.0, role: $0.1, title: $0.2, value: "", depth: 0) }
}

private func makeObservationHandlers(snapshots: [[AXTree.Node]],
                                     screenshotter: FakeScreenshotter = FakeScreenshotter(),
                                     permissions: Bool = true,
                                     instructions: [String: String] = [:]) -> (DefaultHandlers, ScreenshotStore) {
  var index = 0
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let screenshotStore = ScreenshotStore(directory: directory)
  let handlers = DefaultHandlers(
    store: SnapshotStore(),
    executor: FakeExecutor(),
    permissionsTrusted: { permissions },
    appExists: { _ in },
    pidForApp: { _ in 4242 },
    snapshotProvider: { _ in
      defer { index = min(index + 1, snapshots.count - 1) }
      return AXTree.Snapshot(nodes: snapshots[index], elements: [:])
    },
    screenshotter: screenshotter,
    screenshotStore: screenshotStore,
    instructions: instructions,
  )
  return (handlers, screenshotStore)
}

@Test func firstObservationReturnsFullTextAndScreenshot() throws {
  let (handlers, store) = makeObservationHandlers(snapshots: [nodes([(0, "AXWindow", "Finder")])])
  let result = try handlers.appState("com.test.app", disableDiff: false)
  #expect(result["text"] as? String == AXTree.render(nodes([(0, "AXWindow", "Finder")])))
  let skyshot = result["skyshot"] as? [String: Any]
  let screenshot = skyshot?["screenshot"] as? [String: Any]
  #expect((screenshot?["url"] as? String)?.hasPrefix("file://") == true)
  #expect(screenshot?["mimeType"] as? String == "image/png")
  let url = URL(string: screenshot?["url"] as? String ?? "")
  #expect(FileManager.default.fileExists(atPath: url?.path ?? ""))
  try? FileManager.default.removeItem(at: store.directory)
}

@Test func secondObservationReturnsADiffAndReplacesTheScreenshot() throws {
  let first = nodes([(0, "AXWindow", "Finder"), (1, "AXButton", "Go")])
  let second = nodes([(0, "AXWindow", "Finder"), (1, "AXButton", "Back"), (2, "AXButton", "New")])
  let (handlers, store) = makeObservationHandlers(snapshots: [first, second])

  let firstResult = try handlers.appState("com.test.app", disableDiff: false)
  let firstURL = URL(string: ((firstResult["skyshot"] as? [String: Any])?["screenshot"] as? [String: Any])?["url"] as? String ?? "")
  let secondResult = try handlers.appState("com.test.app", disableDiff: false)
  let text = secondResult["text"] as? String ?? ""

  #expect(text.contains("diff from the previous"))
  #expect(text.contains("~ 1 AXButton \"Back\""))
  #expect(text.contains("+ 2 AXButton \"New\""))
  #expect(!FileManager.default.fileExists(atPath: firstURL?.path ?? ""))
  let secondURL = URL(string: ((secondResult["skyshot"] as? [String: Any])?["screenshot"] as? [String: Any])?["url"] as? String ?? "")
  #expect(FileManager.default.fileExists(atPath: secondURL?.path ?? ""))
  try? FileManager.default.removeItem(at: store.directory)
}

@Test func disableDiffReturnsTheFullTree() throws {
  let (handlers, store) = makeObservationHandlers(snapshots: [nodes([(0, "AXWindow", "Finder")]), nodes([(0, "AXWindow", "Finder")])])
  _ = try handlers.appState("com.test.app", disableDiff: false)
  let result = try handlers.appState("com.test.app", disableDiff: true)
  #expect(!(result["text"] as? String ?? "").contains("diff from the previous"))
  try? FileManager.default.removeItem(at: store.directory)
}

@Test func appSpecificInstructionsAreIncluded() throws {
  let (handlers, store) = makeObservationHandlers(snapshots: [nodes([(0, "AXWindow", "Finder")])],
                                                  instructions: ["com.test.app": "Use the sidebar."])
  let result = try handlers.appState("com.test.app", disableDiff: true)
  #expect(result["appSpecificInstructions"] as? String == "Use the sidebar.")
  try? FileManager.default.removeItem(at: store.directory)
}

@Test func screenshotFailuresPropagate() throws {
  let screenshotter = FakeScreenshotter()
  screenshotter.error = ServiceError(.permissionsNotGranted, "no screen recording")
  let (handlers, store) = makeObservationHandlers(snapshots: [nodes([(0, "AXWindow", "Finder")])], screenshotter: screenshotter)
  #expect(throws: ServiceError.self) {
    _ = try handlers.appState("com.test.app", disableDiff: false)
  }
  try? FileManager.default.removeItem(at: store.directory)
}

@Test func missingAccessibilityPermissionFailsClosed() throws {
  let (handlers, store) = makeObservationHandlers(snapshots: [nodes([(0, "AXWindow", "Finder")])], permissions: false)
  #expect(throws: ServiceError.self) {
    _ = try handlers.appState("com.test.app", disableDiff: false)
  }
  try? FileManager.default.removeItem(at: store.directory)
}
