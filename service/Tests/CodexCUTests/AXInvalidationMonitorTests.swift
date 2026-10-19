import Testing
import Foundation
@testable import CodexCUCore

@Test func monitorDebouncesAndStops() async throws {
  let monitor = AXInvalidationMonitor()
  var hits = 0
  monitor.watch(app: "com.test.app", pid: getpid()) { hits += 1 }
  #expect(monitor.isWatching("com.test.app"))
  monitor.notifyForTesting("com.test.app")
  monitor.notifyForTesting("com.test.app")
  try await Task.sleep(nanoseconds: 250_000_000)
  #expect(hits == 1)

  monitor.stop(app: "com.test.app")
  #expect(!monitor.isWatching("com.test.app"))
  monitor.notifyForTesting("com.test.app")
  try await Task.sleep(nanoseconds: 120_000_000)
  #expect(hits == 1)
}

@Test func watchReplacesThePreviousEntry() {
  let monitor = AXInvalidationMonitor()
  monitor.watch(app: "com.test.app", pid: getpid()) {}
  monitor.watch(app: "com.test.app", pid: getpid()) {}
  #expect(monitor.isWatching("com.test.app"))
  monitor.stopAll()
  #expect(!monitor.isWatching("com.test.app"))
}
