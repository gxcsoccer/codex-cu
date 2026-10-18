import Foundation

public let apiVersion = "CodexComputerUseIPC-5"

public struct RequestEnvelope {
  public let requestType: String
  public let request: [String: Any]
  public let clientApiVersion: String?
}

public enum RPC {
  /// Returns the response object, or nil for notifications.
  public static func handle(_ message: [String: Any], handlers: ServiceHandlers) -> [String: Any]? {
    guard let method = message["method"] as? String else {
      return errorResponse(id: message["id"], code: .couldNotGetRequestTypeName, message: "missing method")
    }
    guard let id = message["id"] else { return nil } // notification

    switch method {
    case "ping":
      let params = message["params"] as? [String: Any] ?? [:]
      let client = params["clientApiVersion"] as? String
      if let client, client != apiVersion {
        return errorResponse(id: id, code: .incompatibleClientVersion,
                             message: "API version mismatch: client=\(client) server=\(apiVersion)")
      }
      return ["jsonrpc": "2.0", "id": id, "result": ["serverApiVersion": apiVersion]]

    case "request":
      guard let params = message["params"] as? [String: Any] else {
        return errorResponse(id: id, code: .couldNotGetRequestData, message: "missing params")
      }
      guard let requestType = params["requestType"] as? String else {
        return errorResponse(id: id, code: .couldNotGetRequestTypeName, message: "missing requestType")
      }
      if let client = params["clientApiVersion"] as? String, client != apiVersion {
        return errorResponse(id: id, code: .incompatibleClientVersion,
                             message: "API version mismatch: client=\(client) server=\(apiVersion)")
      }
      let request = params["request"] as? [String: Any] ?? [:]
      do {
        let result = try dispatch(requestType: requestType, request: request, handlers: handlers)
        return ["jsonrpc": "2.0", "id": id, "result": result]
      } catch let error as ServiceError {
        return errorResponse(id: id, code: error.code, message: error.message)
      } catch {
        return errorResponse(id: id, code: .unknownError, message: error.localizedDescription)
      }

    default:
      return errorResponse(id: id, code: .couldNotResolveRequestType, message: "unknown method: \(method)")
    }
  }

  static func dispatch(requestType: String, request: [String: Any], handlers: ServiceHandlers) throws -> [String: Any] {
    switch requestType {
    case "ComputerUseIPCListAppsRequest":
      return ["apps": try handlers.listApps()]
    case "ComputerUseIPCAppStartRequest":
      guard let app = request["app"] as? String else { throw ServiceError(.invalidApp, "app is required") }
      return try handlers.startApp(app)
    case "ComputerUseIPCAppGetSkyshotRequest":
      guard let app = request["app"] as? String else { throw ServiceError(.invalidApp, "app is required") }
      return try handlers.appState(app, disableDiff: request["disableDiff"] as? Bool ?? false)
    case "ComputerUseIPCAppPolicyRequest":
      guard let app = request["app"] as? String else { throw ServiceError(.invalidApp, "app is required") }
      return try handlers.policy(app)
    case "ComputerUseIPCAppPerformActionRequest":
      guard let app = request["app"] as? String else { throw ServiceError(.invalidApp, "app is required") }
      guard let action = request["action"] as? [String: Any] else {
        throw ServiceError(.couldNotGetRequestData, "action is required")
      }
      return try handlers.performAction(app, action: action)
    case "ComputerUseIPCStartAudioRecordingRequest", "ComputerUseIPCStopAudioRecordingRequest":
      throw ServiceError(.unhandledEvent, "audio recording is not implemented")
    default:
      throw ServiceError(.couldNotResolveRequestType, "unknown requestType: \(requestType)")
    }
  }

  static func errorResponse(id: Any?, code: ServiceErrorCode, message: String) -> [String: Any] {
    ["jsonrpc": "2.0", "id": id ?? NSNull(), "error": ["code": code.rawValue, "message": message]]
  }
}

public protocol ServiceHandlers {
  func listApps() throws -> [[String: Any]]
  func startApp(_ app: String) throws -> [String: Any]
  func appState(_ app: String, disableDiff: Bool) throws -> [String: Any]
  func policy(_ app: String) throws -> [String: Any]
  func performAction(_ app: String, action: [String: Any]) throws -> [String: Any]
}
