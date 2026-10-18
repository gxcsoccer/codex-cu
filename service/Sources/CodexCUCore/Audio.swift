import Foundation

/// Recording lifecycle. The concrete recorder is injected so the protocol and
/// session rules can be tested without ScreenCaptureKit or TCC.
public protocol AudioRecording {
  /// Starts loopback (system audio) capture. The session timer lives in the
  /// handler so auto-stop and manual stop share one state machine.
  func start() throws
  /// Stops capture and returns a local WAV file URL.
  func stop() throws -> URL
}

public enum AudioLimits {
  public static let defaultDuration = 60_000
  public static let minimumDuration = 100
  public static let maximumDuration = 300_000

  /// Returns the effective duration or throws `couldNotGetRequestData`.
  public static func validate(_ value: Any?) throws -> Int {
    guard let value, !(value is NSNull) else { return defaultDuration }
    let number: Int
    if let int = value as? Int { number = int }
    else if let nsNumber = value as? NSNumber { number = nsNumber.intValue }
    else { throw ServiceError(.couldNotGetRequestData, "maxDurationMilliseconds must be an integer") }
    guard number >= minimumDuration, number <= maximumDuration else {
      throw ServiceError(.couldNotGetRequestData,
                         "maxDurationMilliseconds must be \(minimumDuration)...\(maximumDuration)")
    }
    return number
  }
}
