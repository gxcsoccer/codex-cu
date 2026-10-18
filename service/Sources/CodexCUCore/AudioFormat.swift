import Foundation
import CoreMedia

/// Writes a 16-bit PCM WAV file incrementally. The header is patched on finish,
/// so recording does not need to know the final size up front.
public final class WAVWriter {
  public let url: URL
  public let sampleRate: Int
  public let channels: Int
  private var handle: FileHandle
  private var dataBytes = 0
  private var finished = false

  public init(url: URL, sampleRate: Int, channels: Int) throws {
    self.url = url
    self.sampleRate = sampleRate
    self.channels = channels
    FileManager.default.createFile(atPath: url.path, contents: nil)
    guard let handle = try? FileHandle(forWritingTo: url) else {
      throw ServiceError(.unknownError, "could not open \(url.path) for writing")
    }
    self.handle = handle
    try handle.write(contentsOf: Data(repeating: 0, count: 44))
  }

  public var bytesWritten: Int { dataBytes }

  public func append(_ pcm: Data) throws {
    guard !finished else { throw ServiceError(.unknownError, "WAV writer already finished") }
    guard !pcm.isEmpty else { return }
    try handle.write(contentsOf: pcm)
    dataBytes += pcm.count
  }

  /// Finalizes the RIFF header and returns the file URL.
  @discardableResult
  public func finish() throws -> URL {
    guard !finished else { return url }
    finished = true
    let header = Self.header(sampleRate: sampleRate, channels: channels, dataBytes: dataBytes)
    try handle.seek(toOffset: 0)
    try handle.write(contentsOf: header)
    try handle.close()
    return url
  }

  public static func header(sampleRate: Int, channels: Int, dataBytes: Int, bitsPerSample: Int = 16) -> Data {
    let blockAlign = channels * bitsPerSample / 8
    let byteRate = sampleRate * blockAlign
    var data = Data()
    func append(_ string: String) { data.append(contentsOf: Array(string.utf8)) }
    func append32(_ value: Int) { var le = UInt32(value).littleEndian; withUnsafeBytes(of: &le) { data.append(contentsOf: $0) } }
    func append16(_ value: Int) { var le = UInt16(value).littleEndian; withUnsafeBytes(of: &le) { data.append(contentsOf: $0) } }

    append("RIFF")
    append32(36 + dataBytes)
    append("WAVE")
    append("fmt ")
    append32(16)
    append16(1) // PCM
    append16(channels)
    append32(sampleRate)
    append32(byteRate)
    append16(blockAlign)
    append16(bitsPerSample)
    append("data")
    append32(dataBytes)
    return data
  }
}

/// Converts SCK/CoreMedia audio buffers into interleaved 16-bit PCM.
public enum PCMConverter {
  public static func int16Interleaved(bufferList: UnsafeMutableAudioBufferListPointer,
                                      format: AudioStreamBasicDescription,
                                      frameCount: Int) -> Data {
    guard frameCount > 0, bufferList.count > 0 else { return Data() }
    let channels = max(1, Int(format.mChannelsPerFrame))
    let isFloat = format.mFormatFlags & kAudioFormatFlagIsFloat != 0
    let isNonInterleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0

    var samples = [Int16](repeating: 0, count: frameCount * channels)

    func readSamples(from buffer: AudioBuffer, channel: Int, sourceChannels: Int) {
      guard let data = buffer.mData else { return }
      let count = min(frameCount, Int(buffer.mDataByteSize) / (isFloat ? 4 : 2))
      for frame in 0..<count {
        let sample: Int16
        if isFloat {
          let pointer = data.assumingMemoryBound(to: Float.self)
          let value = pointer[frame * sourceChannels + channel]
          sample = Int16(max(-1, min(1, value)) * 32767)
        } else {
          let pointer = data.assumingMemoryBound(to: Int16.self)
          sample = pointer[frame * sourceChannels + channel]
        }
        samples[frame * channels + channel] = sample
      }
    }

    if isNonInterleaved {
      for (channel, buffer) in bufferList.enumerated() where channel < channels {
        readSamples(from: buffer, channel: 0, sourceChannels: 1)
      }
    } else {
      for channel in 0..<channels {
        readSamples(from: bufferList[0], channel: channel, sourceChannels: channels)
      }
    }

    return samples.withUnsafeBytes { Data($0) }
  }
}
