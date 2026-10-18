import Testing
import Foundation
import CoreMedia
@testable import CodexCUCore

@Test func wavHeaderHasTheExpectedFields() {
  let header = WAVWriter.header(sampleRate: 24_000, channels: 2, dataBytes: 4_800)
  #expect(header.count == 44)
  func u32(_ offset: Int) -> UInt32 {
    header.subdata(in: offset..<(offset + 4)).withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
  }
  func u16(_ offset: Int) -> UInt16 {
    header.subdata(in: offset..<(offset + 2)).withUnsafeBytes { $0.load(as: UInt16.self).littleEndian }
  }
  #expect(String(data: header[0..<4], encoding: .ascii) == "RIFF")
  #expect(u32(4) == 36 + 4_800)
  #expect(String(data: header[8..<12], encoding: .ascii) == "WAVE")
  #expect(u16(20) == 1)
  #expect(u16(22) == 2)
  #expect(u32(24) == 24_000)
  #expect(u32(28) == 96_000)
  #expect(u16(32) == 4)
  #expect(u16(34) == 16)
  #expect(u32(40) == 4_800)
}

@Test func wavWriterPatchesTheDataSizeOnFinish() throws {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
  defer { try? FileManager.default.removeItem(at: url) }
  let writer = try WAVWriter(url: url, sampleRate: 24_000, channels: 2)
  try writer.append(Data(repeating: 0, count: 400))
  try writer.finish()
  let data = try Data(contentsOf: url)
  #expect(data.count == 44 + 400)
  let size = data.subdata(in: 40..<44).withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
  #expect(size == 400)
}

@Test func converterHandlesInterleavedFloatStereo() {
  var samples: [Float] = [0, 0.5, -0.5, 1]
  let asbd = AudioStreamBasicDescription(
    mSampleRate: 24_000,
    mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
    mBytesPerPacket: 8, mFramesPerPacket: 1, mBytesPerFrame: 8,
    mChannelsPerFrame: 2, mBitsPerChannel: 32, mReserved: 0)

  let data = samples.withUnsafeMutableBytes { raw -> Data in
    let list = AudioBufferList.allocate(maximumBuffers: 1)
    defer { free(list.unsafeMutablePointer) }
    list[0] = AudioBuffer(mNumberChannels: 2, mDataByteSize: UInt32(raw.count), mData: raw.baseAddress)
    return PCMConverter.int16Interleaved(bufferList: list, format: asbd, frameCount: 2)
  }

  let values = data.withUnsafeBytes { Array($0.bindMemory(to: Int16.self)) }
  #expect(values.count == 4)
  #expect(values[0] == 0)
  #expect(values[1] > 16_000)   // 0.5
  #expect(values[2] < -16_000)  // -0.5
  #expect(values[3] == 32_767)  // clamped 1.0
}
