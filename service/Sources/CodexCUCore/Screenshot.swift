import AppKit
import Foundation
import ScreenCaptureKit

public protocol ScreenshotCapturing {
  /// Captures the frontmost on-screen window of the process as PNG bytes.
  func capture(pid: pid_t) throws -> Data
}

/// ScreenCaptureKit implementation. Requires Screen Recording permission, the
/// same TCC gate the original service has (without it, SCK fails with -3811).
public final class SystemScreenshotCapturer: ScreenshotCapturing {
  public init() {}

  public func capture(pid: pid_t) throws -> Data {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<Data, Error>?
    Task {
      do {
        result = .success(try await Self.captureAsync(pid: pid))
      } catch {
        result = .failure(error)
      }
      semaphore.signal()
    }
    semaphore.wait()
    guard let result else {
      throw ServiceError(.accessibilityError, "screenshot capture did not produce a result")
    }
    return try result.get()
  }

  static func captureAsync(pid: pid_t) async throws -> Data {
    let content: SCShareableContent
    do {
      content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    } catch {
      throw ServiceError(.permissionsNotGranted,
                         "screen recording permission is required (SCK: \(error.localizedDescription))")
    }
    guard let window = content.windows.first(where: { $0.owningApplication?.processID == pid }) else {
      throw ServiceError(.accessibilityError, "no on-screen window for pid \(pid)")
    }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let configuration = SCStreamConfiguration()
    let scale = NSScreen.main?.backingScaleFactor ?? 2
    configuration.width = Int(window.frame.width * scale)
    configuration.height = Int(window.frame.height * scale)
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    let representation = NSBitmapImageRep(cgImage: image)
    guard let data = representation.representation(using: .png, properties: [:]) else {
      throw ServiceError(.accessibilityError, "could not encode screenshot as PNG")
    }
    return data
  }
}

/// Writes screenshots into a temp directory and returns a `file://` URL, matching
/// the original's `skyshot.screenshot.url` shape. Old files for the same app are
/// removed when a new observation replaces them.
public final class ScreenshotStore {
  public let directory: URL

  public init(directory: URL? = nil) {
    self.directory = directory ?? FileManager.default.temporaryDirectory
      .appendingPathComponent("codex-cu", isDirectory: true)
  }

  public func write(_ data: Data, app: String) throws -> URL {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let safeName = app.replacingOccurrences(of: "/", with: "_")
    let url = directory.appendingPathComponent("\(safeName)-\(UUID().uuidString).png")
    try data.write(to: url)
    return url
  }

  public func remove(_ url: URL?) {
    guard let url else { return }
    try? FileManager.default.removeItem(at: url)
  }
}
