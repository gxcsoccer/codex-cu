import Foundation

/// Error codes shared with the original protocol (-10000 ... -10020).
public enum ServiceErrorCode: Int, Sendable {
  case senderProcessNotAuthenticated = -10000
  case couldNotGetRequestData = -10001
  case couldNotGetRequestTypeName = -10002
  case couldNotResolveRequestType = -10003
  case unhandledEvent = -10004
  case unknownError = -10005
  case appNotAllowed = -10006
  case runningApplicationNotFound = -10007
  case accessibilityError = -10008
  case permissionsNotGranted = -10009
  case invalidApp = -10010
  case noActiveSession = -10011
  case userStoppedSession = -10012
  case incompatibleClientVersion = -10013
  case permissionsPending = -10014
  case blockedURL = -10015
  case userIntervened = -10016
  case couldNotGetSenderPID = -10017
  case ambiguousApp = -10018
  case couldNotGetBootstrapPort = -10019
  case screenLocked = -10020
}

public struct ServiceError: Error, Sendable {
  public let code: ServiceErrorCode
  public let message: String
  public init(_ code: ServiceErrorCode, _ message: String) {
    self.code = code
    self.message = message
  }
}
