import Testing
import Foundation
@testable import CodexCUCore

@Test func builtInInstructionsLoadByBundleAndName() {
  let spotify = AppInstructions.text(for: "com.spotify.client")
  #expect(spotify?.hasPrefix("## Spotify Computer Use") == true)
  #expect(AppInstructions.text(for: "Spotify") == spotify)
  #expect(AppInstructions.text(for: "notion.id")?.hasPrefix("## Notion Computer Use") == true)
  #expect(AppInstructions.text(for: "com.apple.Music")?.hasPrefix("## Music Computer Use") == true)
  #expect(AppInstructions.text(for: "com.unknown.app") == nil)
}

@Test func appStateReturnsBuiltInInstructionsAndOverrides() throws {
  let builtIn = DefaultHandlers(
    store: SnapshotStore(),
    executor: FakeExecutor(),
    permissionsTrusted: { true },
    screenLocked: { false },
    appExists: { _ in },
    pidForApp: { _ in 1 },
    snapshotProvider: { _ in AXTree.Snapshot(nodes: [], elements: [:]) },
    screenshotter: nil,
  )
  let state = try builtIn.appState("com.spotify.client", disableDiff: true)
  #expect((state["appSpecificInstructions"] as? String)?.hasPrefix("## Spotify Computer Use") == true)

  let overridden = DefaultHandlers(
    store: SnapshotStore(),
    executor: FakeExecutor(),
    permissionsTrusted: { true },
    screenLocked: { false },
    appExists: { _ in },
    pidForApp: { _ in 1 },
    snapshotProvider: { _ in AXTree.Snapshot(nodes: [], elements: [:]) },
    screenshotter: nil,
    instructions: ["com.spotify.client": "custom"],
  )
  #expect(try overridden.appState("com.spotify.client", disableDiff: true)["appSpecificInstructions"] as? String == "custom")
}
