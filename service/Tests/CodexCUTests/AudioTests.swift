import Testing
import Foundation
@testable import CodexCUCore

final class FakeAudioRecorder: AudioRecording {
  var starts = 0
  var stops = 0
  var stopURL = URL(fileURLWithPath: "/tmp/fake-audio.wav")
  var failure: Error?

  func start() throws {
    if let failure { throw failure }
    starts += 1
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

@Test func startInvokesTheRecorder() throws {
  let recorder = FakeAudioRecorder()
  _ = try handlers(recorder: recorder).startAudioRecording(["maxDurationMilliseconds": 1500])
  #expect(recorder.starts == 1)
}

@Test func durationsAreValidated() {
  for bad in [99, 300_001, "soon"] {
    #expect(throws: ServiceError.self) {
      _ = try handlers(recorder: FakeAudioRecorder()).startAudioRecording(["maxDurationMilliseconds": bad])
    }
  }
}

@Test func doubleStartIsRejected() throws {
  let h = handlers(recorder: FakeAudioRecorder())
  _ = try h.startAudioRecording(["maxDurationMilliseconds": 60_000])
  #expect(throws: ServiceError.self) { _ = try h.startAudioRecording([:]) }
}

@Test func stopWithoutStartIsRejected() {
  #expect(throws: ServiceError.self) { _ = try handlers(recorder: FakeAudioRecorder()).stopAudioRecording() }
}

@Test func stopReturnsAFileURL() throws {
  let recorder = FakeAudioRecorder()
  let h = handlers(recorder: recorder)
  _ = try h.startAudioRecording(["maxDurationMilliseconds": 60_000])
  let result = try h.stopAudioRecording()
  #expect(result["url"] as? String == "file:///tmp/fake-audio.wav")
  #expect(recorder.stops == 1)
}

@Test func autoStopThenLateStopReturnsTheSameFile() async throws {
  let recorder = FakeAudioRecorder()
  let h = handlers(recorder: recorder)
  _ = try h.startAudioRecording(["maxDurationMilliseconds": 100])
  try await Task.sleep(nanoseconds: 350_000_000)
  let late = try h.stopAudioRecording()
  #expect(late["url"] as? String == "file:///tmp/fake-audio.wav")
  #expect(recorder.stops == 1)
  let again = try h.stopAudioRecording()
  #expect(again["url"] as? String == "file:///tmp/fake-audio.wav")
}

@Test func noRecorderMeansUnsupported() {
  #expect(throws: ServiceError.self) { _ = try handlers(recorder: nil).startAudioRecording([:]) }
  #expect(throws: ServiceError.self) { _ = try handlers(recorder: nil).stopAudioRecording() }
}
