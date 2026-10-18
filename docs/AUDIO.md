# Audio recording

Captured from `@oai/sky`:

```ts
start_audio_recording({ max_duration_ms?: number }): Promise<void>
stop_audio_recording(): Promise<{ filepath, bytes, data_url }>
```

- The recording is **system loopback audio**, not the microphone.
- Duration: integer 100…300000 ms, default 60000.
- Stop returns a 24 kHz stereo WAV: the service replies `{url: "file://…wav"}`,
  and the client reads the file and builds `data_url`.
- Linux uses `ffmpeg` on the PulseAudio monitor; macOS uses ScreenCaptureKit.

## Implementation

`SystemAudioRecorder` (Swift, ScreenCaptureKit):

1. `SCShareableContent` → first display → `SCContentFilter`.
2. `SCStreamConfiguration.capturesAudio = true`,
   `excludesCurrentProcessAudio = true`, `sampleRate = 24000`,
   `channelCount = 2`.
3. `SCStream` audio output → `PCMConverter` (Float32/Int16, planar or
   interleaved → interleaved PCM16) → `WAVWriter`.
4. The handler owns a timer that stops the recording at
   `maxDurationMilliseconds`; the finished URL is retained.
5. `stop` returns `{url}` pointing at the WAV. A stop that arrives **after** the
   auto-stop still returns the finished file (it does not fail as "not active").

Enable it with `--audio`; without the flag the service keeps returning `-10004`
so existing behavior is unchanged.

## Permissions

Screen Recording is required. Without it:

```
-10009 screen recording permission is required for audio capture (SCK: TCC denied)
```

That denial path is covered by the integration test; live capture needs the
permission granted to the service binary (`docs/INSTALL.md`).

## Test coverage

- `WAVWriter` header/field patching.
- `PCMConverter` interleaved Float32 → PCM16 with clamping.
- Session rules (duration validation, double start, stop without start).
- Wire-level denial path (`--audio`, no TCC).
- **Live capture verified**: `live-check --audio` records a 24 kHz stereo WAV
  (26,924 bytes in the recorded run) once Screen Recording is granted.
