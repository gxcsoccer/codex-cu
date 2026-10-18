import Testing
import ApplicationServices
import Foundation
@testable import CodexCUCore

final class FakeExecutor: ActionExecuting {
  enum Call: Equatable {
    case click(button: Int, count: Int, hasElement: Bool)
    case drag(CGPoint, CGPoint)
    case scroll(direction: String, pages: Int, hasElement: Bool)
    case type(String)
    case pressKey(String)
    case paste(String)
    case setValue(String)
    case selectText(String)
    case secondaryAction(String)
  }

  var calls: [Call] = []

  func click(element: AXUIElement?, point: CGPoint?, button: Int, count: Int) throws {
    calls.append(.click(button: button, count: count, hasElement: element != nil))
  }
  func drag(from: CGPoint, to: CGPoint) throws { calls.append(.drag(from, to)) }
  func scroll(element: AXUIElement?, point: CGPoint?, direction: String, pages: Int) throws {
    calls.append(.scroll(direction: direction, pages: pages, hasElement: element != nil))
  }
  func type(_ text: String) throws { calls.append(.type(text)) }
  func pressKey(_ spec: String) throws { calls.append(.pressKey(spec)) }
  func paste(_ text: String, format: String?) throws { calls.append(.paste(text)) }
  func setValue(element: AXUIElement, value: String) throws { calls.append(.setValue(value)) }
  func selectText(element: AXUIElement, text: String) throws { calls.append(.selectText(text)) }
  func secondaryAction(element: AXUIElement, action: String) throws { calls.append(.secondaryAction(action)) }
}

private func makeHandlers(store: SnapshotStore = SnapshotStore(),
                          executor: FakeExecutor = FakeExecutor(),
                          approvalsURL: URL? = nil) -> (DefaultHandlers, SnapshotStore, FakeExecutor) {
  let handlers = DefaultHandlers(
    approvalsURL: approvalsURL,
    store: store,
    executor: executor,
    permissionsTrusted: { true },
    appExists: { _ in },
  )
  return (handlers, store, executor)
}

@Test func clickByElementUsesTheStoredElement() throws {
  let (handlers, store, executor) = makeHandlers()
  store.put(app: "com.test.app", elements: [7: AXUIElementCreateSystemWide()])
  _ = try handlers.performAction("com.test.app", action: [
    "click": [
      "at": ["elementID": ["_0": "7"]],
      "clickCount": 2,
      "mouseButton": 1,
    ],
  ])
  #expect(executor.calls == [.click(button: 1, count: 2, hasElement: true)])
}

@Test func staleElementIDsAreRejectedAfterAnAction() throws {
  let (handlers, store, _) = makeHandlers()
  store.put(app: "com.test.app", elements: [7: AXUIElementCreateSystemWide()])
  _ = try handlers.performAction("com.test.app", action: [
    "click": ["at": ["elementID": ["_0": 7]]],
  ])
  #expect(throws: ServiceError.self) {
    _ = try handlers.performAction("com.test.app", action: [
      "click": ["at": ["elementID": ["_0": 7]]],
    ])
  }
}

@Test func coordinateClicksSkipElementResolution() throws {
  let (handlers, _, executor) = makeHandlers()
  _ = try handlers.performAction("com.test.app", action: [
    "click": ["at": ["coordinate": ["_0": [640, 480]]], "mouseButton": 0],
  ])
  #expect(executor.calls == [.click(button: 0, count: 1, hasElement: false)])
}

@Test func scrollPassesDirectionAndPages() throws {
  let (handlers, store, executor) = makeHandlers()
  store.put(app: "com.test.app", elements: [3: AXUIElementCreateSystemWide()])
  _ = try handlers.performAction("com.test.app", action: [
    "scroll": ["at": ["elementID": ["_0": "3"]], "direction": "down", "pages": 2],
  ])
  #expect(executor.calls == [.scroll(direction: "down", pages: 2, hasElement: true)])
}

@Test func typingPressingAndPastingForwardToTheExecutor() throws {
  let (handlers, _, executor) = makeHandlers()
  _ = try handlers.performAction("com.test.app", action: ["type": ["_0": "你好"]])
  _ = try handlers.performAction("com.test.app", action: ["pressKey": ["_0": "cmd+shift+g"]])
  _ = try handlers.performAction("com.test.app", action: ["paste": ["text": "pasted"]])
  #expect(executor.calls == [.type("你好"), .pressKey("cmd+shift+g"), .paste("pasted")])
}

@Test func setValueAndSecondaryActionResolveElements() throws {
  let (handlers, store, executor) = makeHandlers()
  store.put(app: "com.test.app", elements: [9: AXUIElementCreateSystemWide()])
  _ = try handlers.performAction("com.test.app", action: [
    "setValue": ["elementID": "9", "value": "hello"],
  ])
  store.put(app: "com.test.app", elements: [9: AXUIElementCreateSystemWide()])
  _ = try handlers.performAction("com.test.app", action: [
    "performSecondaryAction": ["elementID": "9", "action": "Raise"],
  ])
  #expect(executor.calls == [.setValue("hello"), .secondaryAction("Raise")])
}

@Test func unknownActionsAreRejected() throws {
  let (handlers, _, _) = makeHandlers()
  #expect(throws: ServiceError.self) {
    _ = try handlers.performAction("com.test.app", action: ["explode": [:]])
  }
}

@Test func policyDenialBlocksActions() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let approvals = directory.appendingPathComponent("approvals.json")
  try #"{"apps":{"com.test.app":{"allowed":false}}}"#.write(to: approvals, atomically: true, encoding: .utf8)
  let (handlers, _, _) = makeHandlers(approvalsURL: approvals)
  #expect(throws: ServiceError.self) {
    _ = try handlers.performAction("com.test.app", action: ["pressKey": ["_0": "return"]])
  }
}
