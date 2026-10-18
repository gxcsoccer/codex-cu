import CoreMedia
import Foundation
import ScreenCaptureKit

/// Loopback (system audio) recorder backed by ScreenCaptureKit, producing a
/// 24 kHz stereo 16-bit PCM WAV — the shape the original stop response points at.
public final class SystemAudioRecorder: NSObject, AudioRecording, SCStreamOutput, SCStreamDelegate {
  public static let sampleRate = 24_000
  public static let channels = 2

  private let outputDirectory: URL
  private let audioQueue = DispatchQueue(label: "codex-cu.audio")
  private let lock = NSLock()
  private var stream: SCStream?
  private var writer: WAVWriter?
  private var timer: DispatchSourceTimer?

  public init(outputDirectory: URL? = nil) {
    self.outputDirectory = outputDirectory ?? FileManager.default.temporaryDirectory
      .appendingPathComponent("codex-cu-audio", isDirectory: true)
  }

  public func start(maxDurationMilliseconds: Int) throws {
    lock.lock()
    let alreadyRunning = stream != nil
    lock.unlock()
    guard !alreadyRunning else {
      throw ServiceError(.unhandledEvent, "audio recording is already active")
    }

    let content = try Self.shareableContent()
    guard let display = content.displays.first else {
      throw ServiceError(.accessibilityError, "no display available for audio capture")
    }
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let configuration = SCStreamConfiguration()
    configuration.capturesAudio = true
    configuration.excludesCurrentProcessAudio = true
    configuration.sampleRate = Self.sampleRate
    configuration.channelCount = Self.channels
    configuration.width = 16
    configuration.height = 16
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)

    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    let url = outputDirectory.appendingPathComponent("recording-\(UUID().uuidString).wav")
    let writer = try WAVWriter(url: url, sampleRate: Self.sampleRate, channels: Self.channels)

    let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
    try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
    try Self.startCapture(stream)

    lock.lock()
    self.stream = stream
    self.writer = writer
    lock.unlock()

    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now() + .milliseconds(max(maxDurationMilliseconds, 100)))
    timer.setEventHandler { [weak self] in _ = try? self?.stop() }
    timer.resume()
    lock.lock()
    self.timer = timer
    lock.unlock()
  }

  public func stop() throws -> URL {
    lock.lock()
    let activeStream = stream
    let activeWriter = writer
    let activeTimer = timer
    stream = nil
    writer = nil
    timer = nil
    lock.unlock()

    guard let activeStream, let activeWriter else {
      throw ServiceError(.unhandledEvent, "audio recording is not active")
    }
    activeTimer?.cancel()
    try Self.stopCapture(activeStream)
    let url = try activeWriter.finish()
    return url
  }

  // MARK: - SCStreamOutput

  public func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                     of type: SCStreamOutputType) {
    guard type == .audio else { return }
    guard let format = CMSampleBufferGetFormatDescription(sampleBuffer),
          let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else { return }
    let frames = CMSampleBufferGetNumSamples(sampleBuffer)
    let channelCount = max(1, Int(asbd.mChannelsPerFrame))
    let buffers = AudioBufferList.allocate(maximumBuffers: channelCount)
    defer { free(buffers.unsafeMutablePointer) }
    var block: CMBlockBuffer?
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      bufferListSizeNeededOut: nil,
      bufferListOut: buffers.unsafeMutablePointer,
      bufferListSize: AudioBufferList.sizeInBytes(maximumBuffers: channelCount),
      blockBufferAllocator: nil,
      blockBufferMemoryAllocator: nil,
      flags: 0,
      blockBufferOut: &block)
    guard status == noErr else { return }
    let data = PCMConverter.int16Interleaved(bufferList: buffers, format: asbd, frameCount: frames)
    guard !data.isEmpty else { return }
    lock.lock()
    try? writer?.append(data)
    lock.unlock()
  }

  // MARK: - synchronization helpers

  private static func shareableContent() throws -> SCShareableContent {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<SCShareableContent, Error>?
    Task {
      do {
        result = .success(try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true))
      } catch {
        result = .failure(error)
      }
      semaphore.signal()
    }
    semaphore.wait()
    switch result {
    case .success(let content): return content
    case .failure(let error):
      throw ServiceError(.permissionsNotGranted,
                         "screen recording permission is required for audio capture (SCK: \(error.localizedDescription))")
    case .none:
      throw ServiceError(.unknownError, "SCK returned no content")
    }
  }

  private static func startCapture(_ stream: SCStream) throws {
    let semaphore = DispatchSemaphore(value: 0)
    var failure: Error?
    stream.startCapture { error in
      failure = error
      semaphore.signal()
    }
    semaphore.wait()
    if let failure {
      throw ServiceError(.accessibilityError, "could not start audio capture: \(failure.localizedDescription)")
    }
  }

  private static func stopCapture(_ stream: SCStream) throws {
    let semaphore = DispatchSemaphore(value: 0)
    var failure: Error?
    stream.stopCapture { error in
      failure = error
      semaphore.signal()
    }
    semaphore.wait()
    if let failure {
      throw ServiceError(.accessibilityError, "could not stop audio capture: \(failure.localizedDescription)")
    }
  }
}
