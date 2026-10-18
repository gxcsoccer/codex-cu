import Foundation
import CodexCUCore

var socketPath = "/tmp/codex-cu.sock"
var arguments = Array(CommandLine.arguments.dropFirst())
while let argument = arguments.first {
  arguments.removeFirst()
  switch argument {
  case "--socket":
    guard let value = arguments.first else {
      FileHandle.standardError.write(Data("--socket requires a path\n".utf8))
      exit(2)
    }
    arguments.removeFirst()
    socketPath = value
  case "--help", "-h":
    print("usage: CodexCU [--socket /path/to/computeruse.sock]")
    exit(0)
  default:
    FileHandle.standardError.write(Data("unknown argument: \(argument)\n".utf8))
    exit(2)
  }
}

let server = Server(socketPath: socketPath)
do {
  try server.start()
  print("CodexCU listening on \(socketPath)")
  try server.run()
} catch {
  FileHandle.standardError.write(Data("fatal: \(error)\n".utf8))
  exit(1)
}
