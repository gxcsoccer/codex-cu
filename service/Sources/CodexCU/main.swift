import Foundation
import CodexCUCore

var socketPath = "/tmp/codex-cu.sock"
var approvalsPath: String?
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
  case "--approvals":
    guard let value = arguments.first else {
      FileHandle.standardError.write(Data("--approvals requires a path\n".utf8))
      exit(2)
    }
    arguments.removeFirst()
    approvalsPath = value
  case "--help", "-h":
    print("usage: CodexCU [--socket /path/to/computeruse.sock] [--approvals /path/to/approvals.json]")
    exit(0)
  default:
    FileHandle.standardError.write(Data("unknown argument: \(argument)\n".utf8))
    exit(2)
  }
}

let handlers = approvalsPath.map { path in
  DefaultHandlers(approvalsURL: URL(fileURLWithPath: path))
} ?? DefaultHandlers()
let server = Server(socketPath: socketPath, handlers: handlers)
do {
  try server.start()
  print("CodexCU listening on \(socketPath)")
  try server.run()
} catch {
  FileHandle.standardError.write(Data("fatal: \(error)\n".utf8))
  exit(1)
}
