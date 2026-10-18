import Testing
import Foundation
@testable import CodexCUCore

final class FakeAudioRecorder: AudioRecording {
  var started: [Int] = []
  var stops = 0
  var stopURL = URL(fileURLWithPath: "/tmp/fake-audio.wav")
  var failure: Error?

  func start(maxDurationMilliseconds: Int) throws {
    if let failure { throw failure }
    started.append(maxDurationMilliseconds)
  }

  func stop() throws -> URL {
    if let failure { throw failure }
    stops += 1
    return stopURL
  }
}

private func handlers(recorder: AudioRecording?) -> DefaultHandlers {
  DefaultHandlers(
    store: SnapshotStore(),
    executor: FakeExecutor(),
    permissionsTrusted: { true },
    screenLocked: { false },
    appExists: { _ in },
    snapshotProvider: { _ in AXTree.Snapshot(nodes: [], elements: [:]) },
    screenshotter: nil,
    audioRecorder: recorder,
  )
}

@Test func startUsesTheRequestedDuration() throws {
  let recorder = FakeAudioRecorder()
  _ = try handlers(recorder: recorder).startAudioRecording(["maxDurationMilliseconds": 1500])
  #expect(recorder.started == [1500])
}

@Test func startDefaultsToSixtySeconds() throws {
  let recorder = FakeAudioRecorder()
  _ = try handlers(recorder: recorder).startAudioRecording([:])
  #expect(recorder.started == [60_000])
}

@Test func durationsAreValidated() {
  for bad in [99, 300_001, "soon"] {
    #expect(throws: ServiceError.self) {
      _ = try handlers(recorder: FakeAudioRecorder()).startAudioRecording(["maxDurationMilliseconds": bad])
    }
  }
}

@Test func doubleStartAndStopWithoutStartAreRejected() throws {
  let h = handlers(recorder: FakeAudioRecorder())
  _ = try h.startAudioRecording([:])
  #expect(throws: ServiceError.self) { _ = try h.startAudioRecording([:]) }
}

@Test func stopWithoutStartIsRejected() {
  #expect(throws: ServiceError.self) { _ = try handlers(recorder: FakeAudioRecorder()).stopAudioRecording() }
}

@Test func stopReturnsAFileURL() throws {
  let recorder = FakeAudioRecorder()
  let h = handlers(recorder: recorder)
  _ = try h.startAudioRecording([:])
  let result = try h.stopAudioRecording()
  #expect(result["url"] as? String == "file:///tmp/fake-audio.wav")
  #expect(recorder.stops == 1)
}

@Test func noRecorderMeansUnsupported() {
  #expect(throws: ServiceError.self) { _ = try handlers(recorder: nil).startAudioRecording([:]) }
  #expect(throws: ServiceError.self) { _ = try handlers(recorder: nil).stopAudioRecording() }
}
