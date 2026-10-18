import Foundation

/// Per-app guidance shipped in the original bundle
/// (`Package_ComputerUse.bundle/Contents/Resources/AppInstructions`). The texts
/// are copied verbatim; the bundle-identifier mapping is inferred from the
/// adjacent strings in the service and from the apps those files name.
public enum AppInstructions {
  public static let bundleIDs: [String: String] = [
    "com.apple.Music": "AppleMusic",
    "com.apple.clock": "Clock",
    "notion.id": "Notion",
    "com.apple.iWork.Numbers": "Numbers",
    "com.tinyspeck.slackmacgap": "Slack",
    "com.spotify.client": "Spotify",
    "com.apple.ScreenContinuity": "iPhone Mirroring",
  ]

  public static let names: [String: String] = [
    "music": "AppleMusic",
    "apple music": "AppleMusic",
    "clock": "Clock",
    "notion": "Notion",
    "numbers": "Numbers",
    "slack": "Slack",
    "spotify": "Spotify",
    "iphone mirroring": "iPhone Mirroring",
  ]

  /// Bundle id first, then a case-insensitive display-name match.
  public static func text(for app: String) -> String? {
    if let file = bundleIDs[app] { return load(file) }
    if let file = names[app.lowercased()] { return load(file) }
    return nil
  }

  static func load(_ file: String) -> String? {
    guard let url = Bundle.module.url(forResource: file, withExtension: "md", subdirectory: "AppInstructions"),
          let text = try? String(contentsOf: url, encoding: .utf8),
          !text.isEmpty else { return nil }
    return text
  }
}
