import CoreGraphics

/// Detects a locked screen the same way the original does: the current session
/// dictionary exposes `CGSSessionScreenIsLocked`.
public enum ScreenLock {
  public static func isLocked() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
    return session["CGSSessionScreenIsLocked"] as? Bool ?? false
  }
}
