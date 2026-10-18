import Testing
import Foundation
@testable import CodexCUCore

@Test func encodePrefixesLength() throws {
  let frame = try Framing.encode(["a": 1])
  let length = frame.prefix(4).withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
  #expect(Int(length) == frame.count - 4)
  let decoded = try Framing.decode(frame.subdata(in: 4..<frame.count)) as? [String: Int]
  #expect(decoded?["a"] == 1)
}

@Test func readerHandlesPartialAndMultipleFrames() throws {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: url) }
  let first = try Framing.encode(["n": 1])
  let second = try Framing.encode(["n": 2])
  var combined = Data()
  combined.append(first)
  combined.append(second)
  try combined.write(to: url)

  let reader = FrameReader(handle: try FileHandle(forReadingFrom: url))
  #expect((try reader.nextFrame() as? [String: Int])?["n"] == 1)
  #expect((try reader.nextFrame() as? [String: Int])?["n"] == 2)
}

@Test func readerRejectsOversizedFrames() throws {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: url) }
  var header = Data()
  var length = UInt32(Framing.maxFrameBytes + 1).littleEndian
  withUnsafeBytes(of: &length) { header.append(contentsOf: $0) }
  try header.write(to: url)
  let reader = FrameReader(handle: try FileHandle(forReadingFrom: url))
  #expect(throws: ServiceError.self) { _ = try reader.nextFrame() }
}

@Test func readerRejectsInvalidJSON() throws {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: url) }
  let body = Data("not json".utf8)
  var header = Data()
  var length = UInt32(body.count).littleEndian
  withUnsafeBytes(of: &length) { header.append(contentsOf: $0) }
  try (header + body).write(to: url)
  let reader = FrameReader(handle: try FileHandle(forReadingFrom: url))
  #expect(throws: ServiceError.self) { _ = try reader.nextFrame() }
}
