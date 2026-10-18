import Testing
import Foundation
@testable import CodexCUCore

private func handlers(windowCounts: [Int], permissions: Bool = true, timeout: TimeInterval = 1)
  -> (DefaultHandlers, Box) {
  let box = Box()
  let handlers = DefaultHandlers(
    store: SnapshotStore(),
    executor: FakeExecutor(),
    permissionsTrusted: { permissions },
    appExists: { _ in },
    openApplication: { _ in 4242 },
    windowCount: { _ in
      box.windowCalls += 1
      return windowCounts[min(box.windowCalls - 1, windowCounts.count - 1)]
    },
    wait: { interval in box.waits.append(interval) },
    launchTimeout: timeout,
  )
  return (handlers, box)
}

final class Box {
  var windowCalls = 0
  var waits: [TimeInterval] = []
}

@Test func startAppWaitsForTheFirstWindow() throws {
  let (handlers, box) = handlers(windowCounts: [0, 0, 1])
  let result = try handlers.startApp("com.example.app")
  #expect(result["pid"] as? Int == 4242)
  #expect(box.waits.count == 2)
  #expect(box.windowCalls == 3)
}

@Test func startAppStopsWaitingAtTheTimeout() throws {
  let (handlers, box) = handlers(windowCounts: [0], timeout: 0.3)
  _ = try handlers.startApp("com.example.app")
  #expect(box.waits.count == 3)
}

@Test func startAppSkipsTheWaitWithoutAccessibility() throws {
  let (handlers, box) = handlers(windowCounts: [0], permissions: false)
  _ = try handlers.startApp("com.example.app")
  #expect(box.waits.isEmpty)
  #expect(box.windowCalls == 0)
}
