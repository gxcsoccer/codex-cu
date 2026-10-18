import Testing
import ApplicationServices
@testable import CodexCUCore

@Test func resolvesElementsFromTheLatestSnapshot() throws {
  let store = SnapshotStore()
  let element = AXUIElementCreateSystemWide()
  let revision = store.put(app: "app", elements: [1: element])
  #expect(revision == 1)
  #expect(CFEqual(try store.resolve(app: "app", elementID: 1), element))
}

@Test func invalidatedSnapshotsFailClosed() {
  let store = SnapshotStore()
  store.put(app: "app", elements: [1: AXUIElementCreateSystemWide()])
  store.invalidate(app: "app")
  #expect(throws: ServiceError.self) { _ = try store.resolve(app: "app", elementID: 1) }
}

@Test func unknownAppsFailClosed() {
  #expect(throws: ServiceError.self) { _ = try SnapshotStore().resolve(app: "nope", elementID: 1) }
}
