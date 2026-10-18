import CoreGraphics

/// Parses the original `pressKey` syntax: `cmd+shift+g`, `return`, `f5`, ...
public enum KeyCodes {
  public struct Chord {
    public let flags: CGEventFlags
    public let key: CGKeyCode
  }

  private static let keys: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26,
    "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35,
    "return": 36, "enter": 36, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42,
    ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49, "`": 50,
    "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "forwarddelete": 117,
    "left": 123, "right": 124, "down": 125, "up": 126,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
  ]

  public static func parse(_ spec: String) throws -> Chord {
    let tokens = spec.lowercased()
      .split(separator: "+")
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    guard let keyName = tokens.last else {
      throw ServiceError(.couldNotGetRequestData, "empty key specification")
    }
    var flags: CGEventFlags = []
    for modifier in tokens.dropLast() {
      switch modifier {
      case "cmd", "command", "⌘": flags.insert(.maskCommand)
      case "shift", "⇧": flags.insert(.maskShift)
      case "alt", "option", "opt", "⌥": flags.insert(.maskAlternate)
      case "ctrl", "control", "⌃": flags.insert(.maskControl)
      default:
        throw ServiceError(.couldNotGetRequestData, "unknown modifier: \(modifier)")
      }
    }
    guard let key = keys[keyName] else {
      throw ServiceError(.couldNotGetRequestData, "unknown key: \(keyName)")
    }
    return Chord(flags: flags, key: key)
  }
}
