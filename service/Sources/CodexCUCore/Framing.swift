import Foundation
import Darwin

/// 4-byte little-endian length + UTF-8 JSON, matching the original native pipe.
public enum Framing {
  public static let maxFrameBytes = 8 * 1024 * 1024

  public static func encode(_ object: Any) throws -> Data {
    let body = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    guard body.count <= maxFrameBytes else {
      throw ServiceError(.couldNotGetRequestData, "frame too large: \(body.count)")
    }
    var frame = Data(capacity: 4 + body.count)
    var length = UInt32(body.count).littleEndian
    withUnsafeBytes(of: &length) { frame.append(contentsOf: $0) }
    frame.append(body)
    return frame
  }

  public static func decode(_ body: Data) throws -> Any {
    do {
      return try JSONSerialization.jsonObject(with: body)
    } catch {
      throw ServiceError(.couldNotGetRequestData, "invalid JSON frame: \(error.localizedDescription)")
    }
  }
}

/// Buffered reader for length-prefixed frames over a file descriptor.
public final class FrameReader {
  private let handle: FileHandle // retained so the descriptor stays open
  private let fd: Int32
  private var buffer = Data()

  public init(handle: FileHandle) {
    self.handle = handle
    self.fd = handle.fileDescriptor
  }

  /// Returns nil on clean EOF.
  public func nextFrame() throws -> Any? {
    while true {
      if buffer.count >= 4 {
        let length = Int(buffer.prefix(4).withUnsafeBytes { $0.load(as: UInt32.self) }.littleEndian)
        guard length <= Framing.maxFrameBytes else {
          throw ServiceError(.couldNotGetRequestData, "frame too large: \(length)")
        }
        if buffer.count >= 4 + length {
          let body = buffer.subdata(in: 4..<(4 + length))
          buffer.removeSubrange(0..<(4 + length))
          return try Framing.decode(body)
        }
      }
      var chunk = [UInt8](repeating: 0, count: 64 * 1024)
      let count = Darwin.read(fd, &chunk, chunk.count)
      if count == 0 { return nil }
      if count < 0 {
        if errno == EINTR { continue }
        throw ServiceError(.couldNotGetRequestData, "read failed: errno \(errno)")
      }
      buffer.append(contentsOf: chunk[0..<count])
    }
  }
}
