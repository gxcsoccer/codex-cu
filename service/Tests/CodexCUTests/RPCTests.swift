import Foundation
import Testing
@testable import CodexCUCore

struct FakeHandlers: ServiceHandlers {
  func listApps() throws -> [[String: Any]] {
    [["bundleIdentifier": "com.apple.finder", "name": "Finder", "pid": 1]]
  }
  func startApp(_ app: String) throws -> [String: Any] { ["app": app, "pid": 2] }
  func appState(_ app: String, disableDiff: Bool) throws -> [String: Any] { ["app": app, "text": "0 AXWindow"] }
  func policy(_ app: String) throws -> [String: Any] { ["allowed": true] }
  func performAction(_ app: String, action: [String: Any]) throws -> [String: Any] {
    throw ServiceError(.permissionsNotGranted, "denied")
  }
}

@Test func pingEchoesVersion() {
  let response = RPC.handle([
    "jsonrpc": "2.0", "id": 1, "method": "ping",
    "params": ["clientApiVersion": apiVersion],
  ], handlers: FakeHandlers())
  #expect((response?["result"] as? [String: String])?["serverApiVersion"] == apiVersion)
}

@Test func pingRejectsVersionMismatch() {
  let response = RPC.handle([
    "jsonrpc": "2.0", "id": 1, "method": "ping",
    "params": ["clientApiVersion": "CodexComputerUseIPC-4"],
  ], handlers: FakeHandlers())
  #expect((response?["error"] as? [String: Any])?["code"] as? Int == ServiceErrorCode.incompatibleClientVersion.rawValue)
}

@Test func listAppsRequest() {
  let response = RPC.handle([
    "jsonrpc": "2.0", "id": 2, "method": "request",
    "params": [
      "clientApiVersion": apiVersion,
      "requestType": "ComputerUseIPCListAppsRequest",
      "request": [:],
    ],
  ], handlers: FakeHandlers())
  let apps = (response?["result"] as? [String: Any])?["apps"] as? [[String: Any]]
  #expect(apps?.first?["bundleIdentifier"] as? String == "com.apple.finder")
}

@Test func unknownRequestTypeReturnsCode() {
  let response = RPC.handle([
    "jsonrpc": "2.0", "id": 3, "method": "request",
    "params": ["requestType": "Nope", "request": [:]],
  ], handlers: FakeHandlers())
  #expect((response?["error"] as? [String: Any])?["code"] as? Int == ServiceErrorCode.couldNotResolveRequestType.rawValue)
}

@Test func performActionErrorPropagates() {
  let response = RPC.handle([
    "jsonrpc": "2.0", "id": 4, "method": "request",
    "params": [
      "requestType": "ComputerUseIPCAppPerformActionRequest",
      "request": ["app": "com.apple.finder", "action": ["click": [:]]],
    ],
  ], handlers: FakeHandlers())
  #expect((response?["error"] as? [String: Any])?["code"] as? Int == ServiceErrorCode.permissionsNotGranted.rawValue)
}

@Test func notificationsAreIgnored() {
  #expect(RPC.handle(["jsonrpc": "2.0", "method": "ping"], handlers: FakeHandlers()) == nil)
}

@Test func expiredDeadlinesAreRejected() {
  let response = RPC.handle([
    "jsonrpc": "2.0", "id": 9, "method": "request",
    "params": [
      "clientApiVersion": apiVersion,
      "deadlineUnixMilliseconds": 1,
      "requestType": "ComputerUseIPCListAppsRequest",
      "request": [:],
    ],
  ], handlers: FakeHandlers())
  #expect((response?["error"] as? [String: Any])?["code"] as? Int == ServiceErrorCode.couldNotGetRequestData.rawValue)
}

@Test func futureDeadlinesPassThrough() {
  let response = RPC.handle([
    "jsonrpc": "2.0", "id": 10, "method": "request",
    "params": [
      "clientApiVersion": apiVersion,
      "deadlineUnixMilliseconds": Date().timeIntervalSince1970 * 1000 + 60_000,
      "requestType": "ComputerUseIPCListAppsRequest",
      "request": [:],
    ],
  ], handlers: FakeHandlers())
  #expect(response?["result"] != nil)
}
