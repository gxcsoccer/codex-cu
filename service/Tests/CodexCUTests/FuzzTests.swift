import Testing
import Foundation
@testable import CodexCUCore

/// Deterministic pseudo-random bytes: decoding must throw or return a frame,
/// never crash or hang.
@Test func frameReaderSurvivesRandomBytes() throws {
  var seed: UInt64 = 0x9E3779B97F4A7C15
  func next() -> UInt8 {
    seed = seed &* 6364136223846793005 &+ 1442695040888963407
    return UInt8(truncatingIfNeeded: seed >> 33)
  }
  for _ in 0..<20 {
    var data = Data((0..<256).map { _ in next() })
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: url) }
    try data.write(to: url)
    let reader = FrameReader(handle: try FileHandle(forReadingFrom: url))
    do {
      while try reader.nextFrame() != nil {}
    } catch let error as ServiceError {
      #expect(error.code == .couldNotGetRequestData || error.code == .unknownError)
    }
  }
}
