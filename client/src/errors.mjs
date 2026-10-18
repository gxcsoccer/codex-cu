export const ERROR_CODES = {
  senderProcessNotAuthenticated: -10000,
  couldNotGetRequestData: -10001,
  couldNotGetRequestTypeName: -10002,
  couldNotResolveRequestType: -10003,
  unhandledEvent: -10004,
  unknownError: -10005,
  appNotAllowed: -10006,
  runningApplicationNotFound: -10007,
  accessibilityError: -10008,
  permissionsNotGranted: -10009,
  invalidApp: -10010,
  noActiveSession: -10011,
  userStoppedSession: -10012,
  incompatibleClientVersion: -10013,
  permissionsPending: -10014,
  blockedURL: -10015,
  userIntervened: -10016,
  couldNotGetSenderPID: -10017,
  ambiguousApp: -10018,
  couldNotGetBootstrapPort: -10019,
  screenLocked: -10020,
};

export const ERROR_NAMES = new Map(Object.entries(ERROR_CODES).map(([name, code]) => [code, name]));

export class CodexCuError extends Error {
  constructor({ code, message, requestType, request }) {
    super(message);
    this.name = 'CodexCuError';
    this.code = code;
    this.errorName = ERROR_NAMES.get(code) ?? 'jsonRPCError';
    this.requestType = requestType;
    this.request = request;
  }
}

export class ProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProtocolError';
  }
}
